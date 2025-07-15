# src/api_seeder/core.py

import pandas as pd
from typing import Dict, Any, List, Optional
from .api_client import ApiClient
from . import cache
from .payload import build_payload, resolve_placeholder, _get_data
from .logger import log

def _resolve_params(param_mapping: Dict[str, str], row: pd.Series) -> Dict[str, Any]:
    """
    Résout les placeholders dans un dictionnaire de paramètres de requête.
    """
    resolved_params = {}
    for key, value in param_mapping.items():
        if isinstance(value, str) and value.startswith('${'):
            resolved_value = resolve_placeholder(value, row)
            if resolved_value is not None:
                resolved_params[key] = resolved_value
        else:
            resolved_params[key] = value
    return resolved_params

def _extract_entity_from_response(response_data: Any, config: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Extrait le premier objet de l'entité depuis une réponse d'API, en gérant
    les réponses paginées (via la clé 'data'), les tableaux directs et les objets directs.
    
    Args:
        response_data: Le JSON parsé de la réponse de l'API.
        config: La section de configuration `id_lookup_config` de l'étape.
        
    Returns:
        Un dictionnaire représentant l'entité, ou None si non trouvé.
    """
    # La clé dans la réponse où se trouve la liste des résultats (ex: "data", "content").
    # Si non spécifié, on suppose que la réponse est la liste elle-même.
    data_path = config.get("lookup_response_data_path")

    results = response_data
    if data_path and isinstance(response_data, dict):
        results = response_data.get(data_path)

    # Si `results` est une liste, on prend le premier élément.
    if isinstance(results, list):
        return results[0] if results else None
    
    # Si `results` est un dictionnaire (cas d'une réponse avec un seul objet direct).
    elif isinstance(results, dict):
        return results
        
    return None

def run_integration_step(step_config: Dict[str, Any], api_client: ApiClient):
    """
    Exécute une seule étape de synchronisation, avec une gestion robuste des formats de réponse.
    """
    step_name = step_config['name']
    log.info(f"\n--- Démarrage de l'étape : {step_name} ---")

    if not step_config.get('enabled', True):
        log.info("  Étape désactivée.")
        return

    source_df = _get_data(step_config['source_file'])
    if source_df is None: return

    failed_records: List[Dict[str, Any]] = []
    success_count = 0
    cache.init_step_cache(step_name)

    mode = step_config.get("mode", "sync")
    log.info(f"  Mode d'exécution : '{mode}'")

    for index, row in source_df.iterrows():
        excel_row_number = index + 2
        log.info(f"  - Traitement ligne Excel n°{excel_row_number}...")

        lookup_key_col = step_config.get('lookup_key_column')
        if not lookup_key_col:
            log.error(f"    [ÉCHEC] Configuration manquante: 'lookup_key_column'.")
            failed_records.append({'original_excel_row': excel_row_number, **row.to_dict(), 'error_reason': "Configuration manquante: lookup_key_column"})
            continue
        lookup_value = row.get(lookup_key_col)
        
        entity = None
        lookup_config = step_config.get('id_lookup_config', {})

        # 1. Toujours chercher l'entité d'abord
        if lookup_config:
            try:
                response = api_client.get_entity(
                    endpoint=lookup_config['lookup_endpoint'],
                    params={lookup_config['lookup_query_param']: lookup_value}
                )
                if response.status_code == 200:
                    # Utilisation de la nouvelle fonction d'extraction robuste
                    entity = _extract_entity_from_response(response.json(), lookup_config)
                    if entity:
                        log.info("    Entité existante trouvée via la recherche.")
            except Exception as e:
                log.warning(f"    AVERTISSEMENT: La recherche préventive a échoué: {e}")

        # 2. Si non trouvée et que le mode n'est pas 'lookup_only', la créer
        if not entity and mode == "sync":
            log.info("    Entité non trouvée, tentative de création...")
            request_params = _resolve_params(step_config.get("request_params", {}), row)
            p = build_payload(row, step_config['payload_mapping'])
            
            if p is None:
                log.error(f"    [ÉCHEC] Le payload n'a pas pu être construit (dépendance manquante).")
                failed_records.append({'original_excel_row': excel_row_number, **row.to_dict(), 'error_reason': 'Construction du payload échouée'})
                continue
            
            try:
                response = api_client.create_entity(endpoint=step_config['endpoint'], payload=p, params=request_params)
                
                if 200 <= response.status_code < 300:
                    entity = response.json()
                elif response.status_code == 409:
                    log.warning("    Conflit (409) détecté. Tentative de récupération de l'entité existante.")
                    response_lookup = api_client.get_entity(lookup_config['lookup_endpoint'], {lookup_config['lookup_query_param']: lookup_value})
                    if response_lookup.status_code == 200:
                        entity = _extract_entity_from_response(response_lookup.json(), lookup_config)
                else:
                    log.error(f"    [ÉCHEC] La création a échoué. Code: {response.status_code} - {response.text}")
                    failed_records.append({'original_excel_row': excel_row_number, **row.to_dict(), 'error_code': response.status_code, 'error_body': response.text})
                    continue
            except Exception as e:
                log.error(f"    [ÉCHEC] Erreur de requête lors de la création: {e}")
                failed_records.append({'original_excel_row': excel_row_number, **row.to_dict(), 'error_reason': str(e)})
                continue
        
        # 3. Récupérer et stocker l'ID de l'entité trouvée ou créée
        if entity:
            id_field = step_config.get('response_id_field')
            new_id = entity.get(id_field)
            if new_id:
                cache.store_id(step_name, lookup_value, str(new_id))
                success_count += 1
                log.info(f"    ID '{new_id}' synchronisé pour la clé '{lookup_value}'.")
            else:
                log.error(f"    [ÉCHEC] Entité trouvée/créée mais le champ ID '{id_field}' est manquant dans la réponse: {entity}")
                failed_records.append({'original_excel_row': excel_row_number, **row.to_dict(), 'error_reason': f"Champ ID '{id_field}' manquant dans la réponse de l'API"})
        elif mode == "lookup_only":
             log.warning(f"    [INFO] Entité non trouvée en mode 'lookup_only'.")
             failed_records.append({'original_excel_row': excel_row_number, **row.to_dict(), 'error_reason': 'Entité non trouvée en mode recherche seule'})

    # 4. Sauvegarder le cache et générer le rapport d'erreurs
    cache.save_id_cache()
    if failed_records:
        error_file = f"erreurs_{step_name.replace(' ', '_')}.xlsx"
        error_df = pd.DataFrame(failed_records)
        cols = ['original_excel_row'] + [col for col in error_df.columns if col != 'original_excel_row']
        error_df = error_df[cols]
        error_df.to_excel(error_file, index=False)
        log.info(f"\n  Résumé étape: {success_count} réussis, {len(failed_records)} échecs. Détails dans '{error_file}'.")
    else:
        log.info(f"\n  Résumé étape: {success_count} réussis, 0 échec.")