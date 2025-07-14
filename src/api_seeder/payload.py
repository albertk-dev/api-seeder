# src/api_seeder/payload.py

import pandas as pd
import re
from typing import Dict, Any, Optional
from . import cache

# Ce cache de données est spécifique à la construction du payload (pour les tableaux d'objets)
DATA_CACHE: Dict[str, pd.DataFrame] = {}

def _get_data(file_path: str) -> Optional[pd.DataFrame]:
    """
    Fonction privée au module pour lire un fichier Excel et le mettre en cache.
    """
    abs_path = os.path.abspath(file_path)
    if abs_path not in DATA_CACHE:
        try:
            print(f"  > Lecture du fichier '{file_path}'...")
            DATA_CACHE[abs_path] = pd.read_excel(file_path).astype(str)
        except FileNotFoundError:
            print(f"  [ERREUR] Fichier introuvable : {abs_path}")
            return None
        except Exception as e:
            print(f"  [ERREUR] Impossible de lire le fichier Excel {file_path}: {e}")
            return None
    return DATA_CACHE[abs_path]

def resolve_placeholder(value: str, row: pd.Series) -> Optional[str]:
    """
    Remplace un placeholder comme ${Etape.id:colonne} par sa vraie valeur
    en utilisant le module de cache d'ID.
    """
    match = re.search(r"\$\{(\w[^:]+)\.id:(\w+)\}", value)
    if not match:
        return value

    step_name, lookup_column_name = match.groups()
    if lookup_column_name not in row:
        print(f"    [AVERTISSEMENT] Colonne de recherche '{lookup_column_name}' introuvable.")
        return None
    lookup_value = row[lookup_column_name]

    stored_id = cache.get_id(step_name, lookup_value)
    if stored_id is None:
        print(f"    [AVERTISSEMENT] ID introuvable dans le cache pour '{step_name}' avec la clé '{lookup_value}'.")
    return stored_id

def build_payload(row: pd.Series, mapping: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Construit récursivement le dictionnaire (payload) à envoyer à l'API.
    Gère maintenant le cas spécial `_placeholder` pour créer des tableaux de valeurs simples.
    """
    payload: Dict[str, Any] = {}
    for key, value in mapping.items():
        if isinstance(value, dict):
            # --- MODIFICATION DE LA LOGIQUE ICI ---
            # Cas 1: Tableau (d'objets ou de valeurs simples) depuis un autre fichier
            if "source_file" in value:
                child_df = _get_data(value['source_file'])
                if child_df is None: return None
                parent_link_val = row[value['link_column_parent']]
                child_rows = child_df[child_df[value['link_column_child']] == parent_link_val]
                
                # --- NOUVELLE LOGIQUE DE DÉTECTION ---
                # On vérifie si le mapping interne est pour un tableau de valeurs simples
                is_simple_array = "_placeholder" in value.get("mapping", {})

                if is_simple_array:
                    # On ne veut qu'un tableau de valeurs (ex: [10, 25, 30])
                    simple_values = []
                    placeholder_str = value["mapping"]["_placeholder"]
                    for _, child_row in child_rows.iterrows():
                        # On résoud le placeholder pour chaque ligne enfant
                        resolved_value = resolve_placeholder(placeholder_str, child_row)
                        if resolved_value:
                            simple_values.append(resolved_value)
                    payload[key] = simple_values
                else:
                    # Comportement standard : on veut un tableau d'objets (ex: [{"key": "val"}, ...])
                    items = [build_payload(child_row, value['mapping']) for _, child_row in child_rows.iterrows()]
                    payload[key] = [item for item in items if item is not None]
            
            # Cas 2: Tableau simple depuis une chaîne de caractères
            elif "split_by" in value:
                source_val = row.get(value['source_column'], "")
                payload[key] = [item.strip() for item in source_val.split(value['split_by'])]
            # Cas 3: Objet JSON imbriqué
            else:
                payload[key] = build_payload(row, value)
        elif isinstance(value, str):
            # Cas 4: Dépendance à résoudre
            if value.startswith('${'):
                resolved_value = resolve_placeholder(value, row)
                if resolved_value is None: return None
                payload[key] = resolved_value
            # Cas 5: Mapping simple depuis une colonne
            elif value in row.index:
                payload[key] = row[value]
            # Cas 6: Valeur statique (chaîne de caractères)
            else:
                payload[key] = value
        else:
             # Cas 7: Valeur statique (nombre, booléen, etc.)
             payload[key] = value
    return payload