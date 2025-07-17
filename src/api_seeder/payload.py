# src/api_seeder/payload.py

import pandas as pd
import re
import os
from typing import Dict, Any, Optional

from . import cache
from .logger import log
from .api_client import ApiClient
from .utils import extract_entity_from_response # Import depuis utils.py

# Cache de données pour éviter de lire plusieurs fois le même fichier Excel
DATA_CACHE: Dict[str, pd.DataFrame] = {} 

def _get_data(file_path: str) -> Optional[pd.DataFrame]:
    """
    Fonction privée pour lire un fichier Excel et le mettre en cache.
    Remplace les cellules vides par une chaîne vide dès la lecture.
    """
    abs_path = os.path.abspath(file_path)
    if abs_path not in DATA_CACHE:
        try:
            log.info(f"  > Lecture du fichier '{file_path}'...")
            DATA_CACHE[abs_path] = pd.read_excel(file_path, dtype=str).fillna('')
        except FileNotFoundError:
            log.error(f"  [ERREUR] Fichier introuvable : {abs_path}")
            return None
        except Exception as e:
            log.error(f"  [ERREUR] Impossible de lire le fichier Excel {file_path}: {e}")
            return None
    return DATA_CACHE[abs_path]

def resolve_placeholder(
    value: str, 
    row: pd.Series, 
    api_client: ApiClient, 
    global_config: Dict[str, Any]
) -> Optional[str]:
    """
    Remplace un placeholder, soit depuis le cache (${...}), soit via un appel API direct (#{...}).
    """
    # Cas 1: Placeholder de cache standard ${...}
    if value.startswith('${'):
        # ... (logique inchangée) ...
        match = re.search(r"\$\{(\w[^:]+)\.id:(\w+)\}", value)
        if not match: return value
        step_name, lookup_column_name = match.groups()
        if lookup_column_name not in row:
            log.warning(f"    [AVERTISSEMENT] Colonne de recherche '{lookup_column_name}' introuvable.")
            return None
        lookup_value = row.get(lookup_column_name, '')
        stored_id = cache.get_id(step_name, lookup_value)
        if stored_id is None:
            log.warning(f"    [AVERTISSEMENT] ID introuvable dans le cache pour l'étape '{step_name}' avec la clé '{lookup_value}'.")
        return stored_id

    # --- NOUVELLE LOGIQUE POUR LE LOOKUP À LA VOLÉE ---
    # Cas 2: Placeholder de lookup direct #{lookup.NOM_DU_LOOKUP}
    elif value.startswith('#{'):
        match = re.search(r"#\{lookup\.([^}]+)\}", value)
        if not match: return None
        
        lookup_name = match.group(1)
        log.info(f"    > Exécution du lookup à la volée nommé '{lookup_name}'...")
        
        # Trouver la définition du lookup dans la configuration globale
        lookup_config = global_config.get("lookups", {}).get(lookup_name)
        if not lookup_config:
            log.error(f"    [ÉCHEC LOOKUP] Définition de lookup '{lookup_name}' introuvable dans config.json.")
            return None
        
        try:
            # Construire les paramètres de la requête à partir de la ligne actuelle
            params = {}
            for param_name, source_col in lookup_config.get("params", {}).items():
                cell_value = row.get(source_col)
                if pd.isna(cell_value):
                    log.error(f"    [ÉCHEC LOOKUP] La colonne source '{source_col}' pour le lookup '{lookup_name}' est vide.")
                    return None
                 # --- CORRECTION : Convertir les valeurs en float si possible ---
                try:
                    # Remplacer la virgule et convertir en nombre
                    params[param_name] = float(str(cell_value).replace(',', '.'))
                except (ValueError, TypeError):
                    # Si la conversion échoue, on garde la chaîne
                    params[param_name] = cell_value
            
            response = api_client.get_entity(lookup_config['endpoint'], params)

            if response.status_code == 200:
                # Utiliser notre fonction utilitaire pour extraire l'entité
                entity = extract_entity_from_response(response.json(), lookup_config)
                response_field = lookup_config.get("response_id_field", "id")
                
                if entity and entity.get(response_field) is not None:
                    return str(entity.get(response_field))
                else:
                    log.warning(f"    [INFO LOOKUP] Le lookup a réussi mais n'a retourné aucune entité ou aucun ID.")
                    return None
            else:
                log.warning(f"    [ÉCHEC LOOKUP] La requête a échoué avec le code {response.status_code}.")
                return None
        except Exception as e:
            log.error(f"    [ÉCHEC LOOKUP] L'appel API à la volée a échoué : {e}")
            return None
            
    return value

# --- FONCTION PRINCIPALE ---

def build_payload(
    row: pd.Series, 
    mapping: Dict[str, Any], 
    api_client: ApiClient, 
    global_config: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """
    Construit récursivement le dictionnaire (payload) à envoyer à l'API.
    Renvoie None si une dépendance cruciale échoue ou si le payload est vide.
    """
    payload: Dict[str, Any] = {}
    try:
        for key, value_mapping in mapping.items():
            if '@options' in key:
                continue

            final_value = None
            
            #
            # Cas A: Le mapping est un dictionnaire (objet imbriqué, tableau, etc.)
            #
            if isinstance(value_mapping, dict):
                # Sous-cas A1: Tableau depuis un autre fichier
                if "source_file" in value_mapping:
                    child_df = _get_data(value_mapping['source_file'])
                    if child_df is None: continue
                    parent_link_val = row.get(value_mapping['link_column_parent'], '')
                    if not parent_link_val: continue
                    child_rows = child_df[child_df[value_mapping['link_column_child']] == parent_link_val]
                    
                    if "_placeholder" in value_mapping.get("mapping", {}): # Tableau de valeurs simples
                        placeholder_str = value_mapping["mapping"]["_placeholder"]
                        final_value = [resolve_placeholder(placeholder_str, child_row, api_client, global_config) for _, child_row in child_rows.iterrows()]
                    else: # Tableau d'objets
                        final_value = [build_payload(child_row, value_mapping['mapping'], api_client, global_config) for _, child_row in child_rows.iterrows()]
                    
                    final_value = [v for v in final_value if v is not None] or None

                # Sous-cas A2: Tableau depuis une chaîne de caractères
                elif "split_by" in value_mapping:
                    source_val = row.get(value_mapping['source_column'], "")
                    final_value = [item.strip() for item in source_val.split(value_mapping['split_by'])] if source_val else None
                
                # Sous-cas A3: Objet imbriqué
                else:
                    final_value = build_payload(row, value_mapping, api_client, global_config)
            
            #
            # Cas B: Le mapping est une chaîne de caractères (colonne, placeholder, statique)
            #
            elif isinstance(value_mapping, str):
                if value_mapping.startswith(('${', '#{')): # Dépendance cache ou lookup direct
                    final_value = resolve_placeholder(value_mapping, row, api_client, global_config)
                    if value_mapping.startswith('${') and final_value is None:
                        raise ValueError(f"Dépendance du cache non résolue pour '{value_mapping}'")
                elif value_mapping in row.index: # Mapping de colonne
                    cell_value = row[value_mapping]
                    final_value = cell_value if pd.notna(cell_value) and str(cell_value).strip() != '' else None
                else: # Valeur statique
                    final_value = value_mapping
            
            #
            # Cas C: Le mapping est une liste (tableau statique)
            #
            elif isinstance(value_mapping, list):
                final_value = value_mapping or None
            
            #
            # Cas D: Autre (nombre, booléen...)
            #
            else:
                final_value = value_mapping if pd.notna(value_mapping) else None

            #
            # Gestion finale de la valeur (option empty_value)
            #
            if final_value is None:
                options_key = f"{key}@options"
                if options_key in mapping and isinstance(mapping[options_key], dict):
                    final_value = mapping[options_key].get("empty_value")

            if final_value is not None:
                payload[key] = final_value

    except ValueError as e:
        log.warning(f"    [ÉCHEC PAYLOAD] {e}")
        return None

    return payload if payload else None