# src/api_seeder/core.py

import pandas as pd
from typing import Dict, Any, List, Optional
from .api_client import ApiClient
from . import cache
from .payload import build_payload, resolve_placeholder, _get_data
from .logger import log
from .utils import extract_entity_from_response # Import depuis utils.py

def _resolve_params(param_mapping: Dict[str, str], row: pd.Series, api_client: ApiClient, global_config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Résout les placeholders dans un dictionnaire de paramètres de requête.
    Gère les dépendances, les colonnes de la ligne actuelle, et les valeurs statiques.
    """
    resolved_params = {}
    if not param_mapping:
        return resolved_params

    for key, value in param_mapping.items():
        resolved_value = None
        if isinstance(value, str):
            # --- CORRECTION DE LA LOGIQUE ---
            # Cas 1: C'est une dépendance à résoudre (cache ou lookup direct)
            if value.startswith(('${', '#{')):
                resolved_value = resolve_placeholder(value, row, api_client, global_config)
                if value.startswith('${') and resolved_value is None:
                    raise ValueError(f"Dépendance du cache non résolue pour '{value}'")
            
            # Cas 2: C'est une référence à une colonne dans la ligne actuelle
            elif value in row.index:
                cell_value = row[value]
                if pd.notna(cell_value) and str(cell_value).strip() != '':
                    resolved_value = cell_value
            
            # Cas 3: C'est une valeur statique
            else:
                resolved_value = value
        else:
            # C'est une valeur statique non-string (nombre, booléen)
            resolved_value = value
        
        if resolved_value is not None:
            resolved_params[key] = resolved_value
            
    return resolved_params


def run_integration_step(step_config: Dict[str, Any], api_client: ApiClient, global_config: Dict[str, Any], fail_fast: bool) -> bool:
    """
    Exécute une seule étape de synchronisation.
    
    Args:
        step_config: La configuration de l'étape actuelle.
        api_client: Le client pour effectuer les requêtes API.
        global_config: La configuration globale (pour l'accès au cache, etc.).
        fail_fast: Si True, le script s'arrête à la première erreur bloquante.
        
    Returns:
        True si l'étape s'est terminée (même avec des erreurs non bloquantes).
        False si une erreur bloquante s'est produite en mode fail-fast.
    """
    step_name = step_config['name']
    log.info(f"--- Démarrage de l'étape : {step_name} ---")

    source_df = _get_data(step_config['source_file'])
    if source_df is None:
        log.error(f"ÉCHEC CRITIQUE: Le fichier source pour l'étape '{step_name}' est introuvable.")
        # C'est une erreur bloquante, on retourne toujours False
        return False

    failed_records: List[Dict[str, Any]] = []
    success_count = 0
    cache.init_step_cache(step_name)
    mode = step_config.get("mode", "sync")
    log.info(f"  Mode d'exécution : '{mode}'")

    for index, row in source_df.iterrows():
        excel_row_number = index + 2
        log.info(f"  - Traitement ligne Excel n°{excel_row_number}...")
        
        entity = None
        lookup_config = step_config.get('id_lookup_config', {})

        # 1. Toujours chercher l'entité d'abord
        if lookup_config.get('enabled', True):
            try:
                search_params = _resolve_params(lookup_config.get('lookup_query_params', {}), row, api_client, global_config)
                if not search_params:
                    raise ValueError("Aucun paramètre de recherche valide n'a pu être construit.")
                response = api_client.get_entity(lookup_config['lookup_endpoint'], params=search_params)
                if response.status_code == 200:
                    entity = extract_entity_from_response(response.json(), lookup_config)
                    if entity:
                        log.info("    Entité existante trouvée via la recherche.")
            except ValueError as e:
                log.warning(f"    AVERTISSEMENT: Recherche préventive ignorée. {e}")
            except Exception as e:
                log.warning(f"    AVERTISSEMENT: La recherche préventive a échoué: {e}")

        # 2. Si non trouvée et que le mode n'est pas 'lookup_only', la créer
        if not entity and mode == "sync":
            log.info("    Entité non trouvée, tentative de création...")
            try:
                p = build_payload(row, step_config['payload_mapping'], api_client, global_config)
                if p is None:
                    raise ValueError("Le payload n'a pas pu être construit (dépendance manquante).")
                
                request_params = _resolve_params(step_config.get("request_params", {}), row, api_client, global_config)
                response = api_client.create_entity(endpoint=step_config['endpoint'], payload=p, params=request_params)
                
                if 200 <= response.status_code < 300:
                    entity = response.json()
                elif response.status_code == 409:
                    log.warning("    Conflit (409) détecté. Récupération de l'entité existante.")
                    search_params = _resolve_params(lookup_config.get('lookup_query_params', {}), row, api_client, global_config)
                    response_lookup = api_client.get_entity(lookup_config['lookup_endpoint'], search_params)
                    if response_lookup.status_code == 200:
                        entity = extract_entity_from_response(response_lookup.json(), lookup_config)
                else:
                    log.error(f"    [ÉCHEC] La création a échoué. Code: {response.status_code} - {response.text}")
                    failed_records.append({'original_excel_row': excel_row_number, **row.to_dict(), 'error_code': response.status_code, 'error_body': response.text})
                    # --- AJOUT FAIL-FAST ---
                    if fail_fast: return False
                    continue
            except Exception as e:
                log.error(f"    [ÉCHEC] Erreur lors de la création: {e}")
                failed_records.append({'original_excel_row': excel_row_number, **row.to_dict(), 'error_reason': str(e)})
                # --- AJOUT FAIL-FAST ---
                if fail_fast: return False
                continue
        
        # 3. Récupérer et stocker l'ID
        if entity:
            id_field = step_config.get('response_id_field')
            lookup_key_value = row.get(step_config.get('lookup_key_column'))
            new_id = entity.get(id_field)
            
            if new_id and pd.notna(lookup_key_value):
                cache.store_id(step_name, str(lookup_key_value), str(new_id))
                success_count += 1
                log.info(f"    ID '{new_id}' synchronisé pour la clé '{lookup_key_value}'.")
            else:
                reason = f"Champ ID '{id_field}' manquant dans la réponse" if not new_id else "Clé de lookup manquante/vide dans le fichier Excel"
                log.error(f"    [ÉCHEC] Impossible de synchroniser l'ID. {reason}.")
                failed_records.append({'original_excel_row': excel_row_number, **row.to_dict(), 'error_reason': reason})
                # --- AJOUT FAIL-FAST ---
                if fail_fast: return False
        elif mode == "lookup_only":
             log.warning(f"    [INFO] Entité non trouvée en mode 'lookup_only'.")
             failed_records.append({'original_excel_row': excel_row_number, **row.to_dict(), 'error_reason': 'Entité non trouvée en mode recherche seule'})
             # --- AJOUT FAIL-FAST (Optionnel, car ce n'est pas une "erreur" mais un "non trouvé") ---
             # Si vous considérez un "non trouvé" en mode lookup comme une erreur bloquante :
             if fail_fast: return False

    # 4. Sauvegarde et résumé
    # On ne sauvegarde le cache que si l'étape s'est terminée sans être arrêtée par fail-fast
    cache.save_id_cache()
    if failed_records:
        error_file = f"erreurs_{step_name.replace(' ', '_')}.xlsx"
        error_df = pd.DataFrame(failed_records)
        cols = ['original_excel_row'] + [col for col in error_df.columns if col != 'original_excel_row']
        error_df[cols].to_excel(error_file, index=False)
        log.info(f"\n  Résumé étape: {success_count} réussis, {len(failed_records)} échecs. Détails dans '{error_file}'.")
    else:
        log.info(f"\n  Résumé étape: {success_count} réussis, 0 échec.")
        
    # Si on arrive ici, l'étape s'est terminée. On renvoie True.
    return True