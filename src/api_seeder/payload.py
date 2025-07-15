# src/api_seeder/payload.py

import pandas as pd
import re
import os
from typing import Dict, Any, Optional
from . import cache
from .logger import log

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
            # dtype=str et fillna('') sont cruciaux pour une lecture propre et cohérente
            DATA_CACHE[abs_path] = pd.read_excel(file_path, dtype=str).fillna('')
        except FileNotFoundError:
            log.error(f"  [ERREUR] Fichier introuvable : {abs_path}")
            return None
        except Exception as e:
            log.error(f"  [ERREUR] Impossible de lire le fichier Excel {file_path}: {e}")
            return None
    return DATA_CACHE[abs_path]

def resolve_placeholder(value: str, row: pd.Series) -> Optional[str]:
    """
    Remplace un placeholder comme ${Etape.id:colonne} par sa vraie valeur
    en utilisant le module de cache d'ID.
    """
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

# --- Fonctions d'Aide Privées pour la Construction du Payload ---

def _handle_dict_mapping(key: str, value_dict: Dict[str, Any], row: pd.Series) -> Any:
    """Gère la logique pour les valeurs de mapping de type dictionnaire."""
    # Cas 1: Tableau depuis un autre fichier
    if "source_file" in value_dict:
        child_df = _get_data(value_dict['source_file'])
        if child_df is None: return None
        
        parent_link_val = row.get(value_dict['link_column_parent'])
        if pd.isna(parent_link_val) or parent_link_val == '': return None
        
        child_rows = child_df[child_df[value_dict['link_column_child']] == parent_link_val]
        
        # Sous-cas: Tableau de valeurs simples (ex: [1, 2, 3])
        if "_placeholder" in value_dict.get("mapping", {}):
            placeholder_str = value_dict["mapping"]["_placeholder"]
            simple_values = [resolve_placeholder(placeholder_str, child_row) for _, child_row in child_rows.iterrows()]
            return [v for v in simple_values if v is not None] or None
        # Sous-cas: Tableau d'objets (ex: [{"id": 1}, ...])
        else:
            items = [build_payload(child_row, value_dict['mapping']) for _, child_row in child_rows.iterrows()]
            return [item for item in items if item is not None] or None
    
    # Cas 2: Tableau simple depuis une chaîne de caractères
    elif "split_by" in value_dict:
        source_val = row.get(value_dict['source_column'], "")
        return [item.strip() for item in source_val.split(value_dict['split_by'])] if source_val else None
    
    # Cas 3: Objet JSON imbriqué
    else:
        return build_payload(row, value_dict)

def _handle_str_mapping(value_str: str, row: pd.Series) -> Any:
    """Gère la logique pour les valeurs de mapping de type chaîne."""
    # Cas 1: Dépendance à résoudre
    if value_str.startswith('${'):
        resolved_value = resolve_placeholder(value_str, row)
        if resolved_value is None:
            # Lève une exception pour arrêter la construction de ce payload
            raise ValueError(f"Dépendance cruciale non résolue pour '{value_str}'")
        return resolved_value
    
    # Cas 2: Mapping simple depuis une colonne
    elif value_str in row.index:
        cell_value = row[value_str]
        # On renvoie None pour les chaînes vides ou les valeurs NaN pour une gestion ultérieure
        return cell_value if pd.notna(cell_value) and str(cell_value).strip() != '' else None
    
    # Cas 3: C'est une valeur statique
    else:
        return value_str

# --- Fonction Principale ---

def build_payload(row: pd.Series, mapping: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Construit récursivement le dictionnaire (payload) à envoyer à l'API.
    Renvoie None si une dépendance cruciale échoue ou si le payload est vide.
    """
    payload: Dict[str, Any] = {}
    try:
        for key, value_mapping in mapping.items():
            # Ignorer les clés spéciales d'options
            if '@options' in key:
                continue

            final_value = None
            if isinstance(value_mapping, dict):
                final_value = _handle_dict_mapping(key, value_mapping, row)
            elif isinstance(value_mapping, str):
                final_value = _handle_str_mapping(value_mapping, row)
            elif isinstance(value_mapping, list):
                if value_mapping: final_value = value_mapping
            else: # Nombres, booléens...
                if pd.notna(value_mapping): final_value = value_mapping

            # Gérer la valeur par défaut pour les champs vides
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