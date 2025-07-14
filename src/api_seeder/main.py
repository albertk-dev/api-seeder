import pandas as pd
import requests
import json
import os
import re
import argparse
from typing import Dict, Any, List, Optional

# --- Variables Globales ---
# Stocke les ID générés par l'API pour les réutiliser dans les dépendances.
# Format: { 'NomEtape': { 'cle_de_recherche': 'id_genere' } }
ID_STORE: Dict[str, Dict[str, str]] = {}

# Met en cache les dataframes Excel pour éviter de lire le même fichier plusieurs fois.
DATA_CACHE: Dict[str, pd.DataFrame] = {}


def get_data(file_path: str) -> Optional[pd.DataFrame]:
    """
    Lit un fichier Excel et le met en cache.
    Renvoie le DataFrame ou None en cas d'erreur.
    """
    abs_path = os.path.abspath(file_path)
    if abs_path not in DATA_CACHE:
        try:
            print(f"  > Lecture et mise en cache du fichier '{file_path}'...")
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
    en la cherchant dans le ID_STORE.
    """
    match = re.search(r"\$\{(\w[^:]+)\.id:(\w+)\}", value)
    if not match:
        return value

    step_name, lookup_column_name = match.groups()
    if lookup_column_name not in row:
        print(f"    [AVERTISSEMENT] Colonne de recherche '{lookup_column_name}' introuvable dans la ligne actuelle.")
        return None
    lookup_value = row[lookup_column_name]

    try:
        return ID_STORE[step_name][lookup_value]
    except KeyError:
        print(f"    [AVERTISSEMENT] ID introuvable pour l'étape '{step_name}' avec la clé '{lookup_value}'.")
        return None


def build_payload(row: pd.Series, mapping: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Construit récursivement le dictionnaire (payload) à envoyer à l'API
    à partir d'une ligne de données et d'un mapping de configuration.
    """
    payload: Dict[str, Any] = {}
    for key, value in mapping.items():
        if isinstance(value, dict):
            # Cas 1: Tableau d'objets depuis un autre fichier
            if "source_file" in value:
                child_df = get_data(value['source_file'])
                if child_df is None: return None
                parent_link_val = row[value['link_column_parent']]
                child_rows = child_df[child_df[value['link_column_child']] == parent_link_val]
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
                if resolved_value is None: return None # Échouer la création si une dépendance est manquante
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


def run_integration_step(step_config: Dict[str, Any], base_url: str, global_headers: Dict[str, str]):
    """
    Exécute une seule étape d'intégration.
    Cette fonction inclut désormais le numéro de la ligne Excel dans les rapports d'erreurs.
    """
    step_name = step_config['name']
    print(f"\n--- Démarrage de l'étape : {step_name} ---")

    if not step_config.get('enabled', True):
        print("  Étape désactivée. Passage à la suivante.")
        return

    source_df = get_data(step_config['source_file'])
    if source_df is None: return

    api_url = f"{base_url.rstrip('/')}/{step_config['endpoint'].lstrip('/')}"
    headers = {**global_headers, 'Content-Type': 'application/json'}
    failed_records: List[Dict[str, Any]] = []
    success_count = 0
    ID_STORE[step_name] = {}

    print(f"  {len(source_df)} enregistrements à traiter...")
    for index, row in source_df.iterrows():
        # Le numéro de ligne Excel est l'index du dataframe (qui commence à 0) + 2 (1 pour l'en-tête, 1 pour passer de 0-based à 1-based).
        excel_row_number = index + 2
        print(f"  - Traitement de la ligne Excel n°{excel_row_number}...")
        payload = build_payload(row, step_config['payload_mapping'])

        if payload is None:
            print(f"    [ÉCHEC] Le payload n'a pas pu être construit (dépendance manquante).")
            # --- MODIFICATION 1 ---
            failed_records.append({
                'original_excel_row': excel_row_number,
                **row.to_dict(),
                'error_reason': 'Construction du payload échouée'
            })
            continue
        
        try:
            response = requests.request(
                method=step_config['method'], url=api_url,
                data=json.dumps(payload), headers=headers, timeout=30
            )

            if not (200 <= response.status_code < 300):
                print(f"    [ÉCHEC] La requête principale a échoué. Code: {response.status_code} - {response.text}")
                # --- MODIFICATION 2 ---
                failed_records.append({
                    'original_excel_row': excel_row_number,
                    **row.to_dict(),
                    'error_code': response.status_code,
                    'error_body': response.text
                })
                continue
            
            success_count += 1
            new_id = None
            response_data = {}
            id_field = step_config.get('response_id_field')

            try:
                response_data = response.json()
            except json.JSONDecodeError:
                print("    [INFO] Réponse de création valide mais avec un corps vide.")

            if id_field and id_field in response_data:
                new_id = response_data.get(id_field)
                print(f"    [SUCCÈS] Code: {response.status_code}. ID '{new_id}' trouvé dans la réponse directe.")
            else:
                # ... (logique de recherche d'ID inchangée) ...
                lookup_config = step_config.get('id_lookup_on_creation')
                if lookup_config and lookup_config.get('enabled'):
                    print(f"    [INFO] ID non trouvé directement, lancement de la recherche post-création...")
                    lookup_key_col = step_config.get('lookup_key_column')
                    lookup_value = row.get(lookup_key_col)
                    lookup_endpoint_path = lookup_config['lookup_endpoint']
                    lookup_url = f"{base_url.rstrip('/')}/{lookup_endpoint_path.lstrip('/')}"
                    params = {lookup_config['lookup_query_param']: lookup_value}
                    try:
                        lookup_response = requests.get(lookup_url, headers=global_headers, params=params, timeout=20)
                        lookup_response.raise_for_status()
                        lookup_data = lookup_response.json()
                        result_obj = None
                        if isinstance(lookup_data, list) and len(lookup_data) > 0:
                            result_obj = lookup_data[0]
                        elif isinstance(lookup_data, dict):
                             result_obj = lookup_data
                        if result_obj and id_field in result_obj:
                            new_id = result_obj.get(id_field)
                            print(f"    [SUCCÈS] ID '{new_id}' trouvé via la recherche GET.")
                        else:
                            print(f"    [ÉCHEC RECHERCHE] L'objet trouvé n'a pas de champ '{id_field}' ou aucun objet n'a été trouvé.")
                    except requests.exceptions.RequestException as e:
                        print(f"    [ÉCHEC RECHERCHE] La requête de recherche a échoué: {e}")
            
            if new_id is not None:
                lookup_key_col = step_config.get('lookup_key_column')
                if lookup_key_col:
                    lookup_value = row[lookup_key_col]
                    ID_STORE[step_name][lookup_value] = str(new_id)
            else:
                print(f"    [AVERTISSEMENT] Impossible de déterminer l'ID pour la ligne Excel n°{excel_row_number}. Les dépendances futures pourraient échouer.")

        except requests.exceptions.RequestException as e:
            print(f"    [ÉCHEC] Erreur de requête: {e}")
            # --- MODIFICATION 3 ---
            failed_records.append({
                'original_excel_row': excel_row_number,
                **row.to_dict(),
                'error_reason': str(e)
            })

    if failed_records:
        error_file = f"erreurs_{step_name.replace(' ', '_')}.xlsx"
        # Réorganiser les colonnes pour que le numéro de ligne apparaisse en premier
        error_df = pd.DataFrame(failed_records)
        cols = ['original_excel_row'] + [col for col in error_df.columns if col != 'original_excel_row']
        error_df = error_df[cols]
        error_df.to_excel(error_file, index=False)
        print(f"\n  Résumé étape: {success_count} réussis, {len(failed_records)} échecs. Détails dans '{error_file}'.")
    else:
        print(f"\n  Résumé étape: {success_count} réussis, 0 échec.")

def start_seeder(config_path: str):
    """
    Point d'entrée logique, orchestre l'intégration à partir du fichier de configuration.
    """
    print("==============================================")
    print("=             API Seeder v1.0              =")
    print("==============================================")
    
    # Se place dans le répertoire du fichier de config pour que les chemins relatifs fonctionnent
    config_dir = os.path.dirname(os.path.abspath(config_path))
    os.chdir(config_dir)
    config_filename = os.path.basename(config_path)

    try:
        with open(config_filename, 'r', encoding='utf-8') as f:
            config = json.load(f)
    except FileNotFoundError:
        print(f"ERREUR FATALE: Le fichier de configuration '{config_filename}' est introuvable.")
        return
    except json.JSONDecodeError as e:
        print(f"ERREUR FATALE: Le fichier '{config_filename}' n'est pas un JSON valide. {e}")
        return

    # Exécute chaque étape définie dans le fichier de configuration
    for step_config in config.get('integration_steps', []):
        run_integration_step(step_config, config.get('api_base_url', ''), config.get('global_headers', {}))
    
    print("\n--- Ensemencement terminé. ---")


def cli_entry_point():
    """
    Point d'entrée pour la commande en ligne défini dans pyproject.toml.
    """
    parser = argparse.ArgumentParser(description="API Seeder: Outil d'ensemencement de données via API.")
    parser.add_argument("config", help="Chemin vers le fichier de configuration JSON du projet.")
    args = parser.parse_args()
    start_seeder(args.config)


if __name__ == '__main__':
    # Cette condition permet au script d'être exécutable directement
    cli_entry_point()