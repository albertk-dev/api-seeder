# src/api_seeder/core.py

import pandas as pd
from typing import Dict, Any, List
from .api_client import ApiClient
from . import cache
from . import payload

def run_integration_step(step_config: Dict[str, Any], api_client: ApiClient):
    """
    Exécute une seule étape de synchronisation : chercher, puis créer si nécessaire.
    """
    step_name = step_config['name']
    print(f"\n--- Démarrage de l'étape : {step_name} ---")

    if not step_config.get('enabled', True):
        print("  Étape désactivée.")
        return

    source_df = payload._get_data(step_config['source_file'])
    if source_df is None: return

    failed_records: List[Dict[str, Any]] = []
    success_count = 0
    # On initialise le cache pour cette étape pour éviter les données périmées si elle est relancée
    cache.init_step_cache(step_name)

    mode = step_config.get("mode", "sync") # "sync" ou "lookup_only"
    print(f"  Mode d'exécution : '{mode}'")

    for index, row in source_df.iterrows():
        excel_row_number = index + 2
        print(f"  - Traitement ligne Excel n°{excel_row_number}...")

        lookup_key_col = step_config.get('lookup_key_column')
        if not lookup_key_col:
            print(f"    [ÉCHEC] La clé 'lookup_key_column' est manquante dans la configuration de l'étape.")
            failed_records.append({'original_excel_row': excel_row_number, **row.to_dict(), 'error_reason': "Configuration manquante: lookup_key_column"})
            continue
        lookup_value = row.get(lookup_key_col)
        
        entity = None

        # 1. Toujours chercher l'entité d'abord
        lookup_config = step_config.get('id_lookup_on_creation', {})
        if lookup_config.get('enabled'):
            try:
                response = api_client.get_entity(
                    endpoint=lookup_config['lookup_endpoint'],
                    params={lookup_config['lookup_query_param']: lookup_value}
                )
                if response.status_code == 200:
                    results = response.json()
                    if isinstance(results, list) and results:
                        entity = results[0] # On prend le premier résultat
                        print("    Entité trouvée via la recherche.")
            except Exception as e:
                print(f"    AVERTISSEMENT: La recherche préventive a échoué: {e}")

        # 2. Si non trouvée et que le mode n'est pas 'lookup_only', la créer
        if not entity and mode == "sync":
            print("    Entité non trouvée, tentative de création...")
            p = payload.build_payload(row, step_config['payload_mapping'])
            if p is None:
                print(f"    [ÉCHEC] Le payload n'a pas pu être construit (dépendance manquante).")
                failed_records.append({'original_excel_row': excel_row_number, **row.to_dict(), 'error_reason': 'Construction du payload échouée'})
                continue
            
            try:
                response = api_client.create_entity(step_config['endpoint'], p)
                if 200 <= response.status_code < 300:
                    entity = response.json()
                # Gérer le cas du 409 Conflict comme un "presque succès"
                elif response.status_code == 409:
                    print("    Conflit (409) détecté. L'entité existe probablement déjà. Tentative de recherche à nouveau.")
                    # On relance une recherche pour récupérer l'ID de l'entité existante
                    response = api_client.get_entity(lookup_config['lookup_endpoint'], {lookup_config['lookup_query_param']: lookup_value})
                    if response.status_code == 200 and response.json():
                        entity = response.json()[0]
                else:
                    print(f"    [ÉCHEC] La création a échoué. Code: {response.status_code} - {response.text}")
                    failed_records.append({'original_excel_row': excel_row_number, **row.to_dict(), 'error_code': response.status_code, 'error_body': response.text})
                    continue
            except Exception as e:
                print(f"    [ÉCHEC] Erreur de requête lors de la création: {e}")
                failed_records.append({'original_excel_row': excel_row_number, **row.to_dict(), 'error_reason': str(e)})
                continue
        
        # 3. Récupérer et stocker l'ID de l'entité trouvée ou créée
        if entity:
            id_field = step_config['response_id_field']
            new_id = entity.get(id_field)
            if new_id:
                cache.store_id(step_name, lookup_value, str(new_id))
                success_count += 1
                print(f"    ID '{new_id}' synchronisé pour la clé '{lookup_value}'.")
            else:
                print(f"    [ÉCHEC] Entité trouvée/créée mais le champ ID '{id_field}' est manquant.")
                failed_records.append({'original_excel_row': excel_row_number, **row.to_dict(), 'error_reason': f"Champ ID '{id_field}' manquant dans la réponse de l'API"})
        elif mode == "lookup_only":
             print(f"    [ÉCHEC] Entité non trouvée en mode 'lookup_only'.")
             failed_records.append({'original_excel_row': excel_row_number, **row.to_dict(), 'error_reason': 'Entité non trouvée en mode recherche seule'})

    # 4. Sauvegarder le cache et générer le rapport d'erreurs
    cache.save_id_cache()
    if failed_records:
        error_file = f"erreurs_{step_name.replace(' ', '_')}.xlsx"
        error_df = pd.DataFrame(failed_records)
        cols = ['original_excel_row'] + [col for col in error_df.columns if col != 'original_excel_row']
        error_df = error_df[cols]
        error_df.to_excel(error_file, index=False)
        print(f"\n  Résumé étape: {success_count} réussis, {len(failed_records)} échecs. Détails dans '{error_file}'.")
    else:
        print(f"\n  Résumé étape: {success_count} réussis, 0 échec.")