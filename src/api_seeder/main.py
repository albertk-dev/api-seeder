# src/api_seeder/main.py

import os
import json
import argparse
from typing import Dict, Any

# --- Importation des modules de l'application ---
from . import core
from . import cache
from . import generator
from .api_client import ApiClient
from .logger import log
from .utils import get_dependencies_from_mapping

# --- Fonctions d'Orchestration ---

def _check_dependencies(step_config: Dict[str, Any]) -> bool:
    """
    Vérifie si toutes les dépendances d'une étape sont satisfaites en consultant le cache.
    Renvoie True si tout est OK, False sinon.
    """
    payload_deps = get_dependencies_from_mapping(step_config.get("payload_mapping", {}))
    params_deps = get_dependencies_from_mapping(step_config.get("request_params", {}))
    all_dependencies = payload_deps.union(params_deps)

    if not all_dependencies:
        return True # Aucune dépendance, on peut continuer

    log.info(f"  > Vérification des dépendances du cache : {', '.join(all_dependencies)}")
    
    for dep_step_name in all_dependencies:
        if dep_step_name not in cache.ID_STORE or not cache.ID_STORE[dep_step_name]:
            log.warning(f"  [DÉPENDANCE MANQUANTE] L'étape parente '{dep_step_name}' n'a pas été exécutée avec succès ou n'a généré aucun ID.")
            log.warning("  Cette étape sera ignorée pour éviter des erreurs en cascade.")
            return False
            
    return True

def start_seeder(config_path: str, fail_fast: bool = False):
    """
    Orchestre la synchronisation des données (logique pour la commande 'sync').
    """
    log.info("==============================================")
    log.info("=             API Seeder v1.5              =")
    log.info("=             Mode: Synchronisation          =")
    log.info("==============================================")
    
    # Se placer dans le répertoire du fichier de config est crucial pour les chemins relatifs
    config_dir = os.path.dirname(os.path.abspath(config_path))
    os.chdir(config_dir)
    config_filename = os.path.basename(config_path)

    try:
        with open(config_filename, 'r', encoding='utf-8') as f:
            # On charge la configuration globale une seule fois
            global_config = json.load(f)
    except Exception as e:
        log.error(f"ERREUR FATALE: Impossible de lire '{config_filename}'. Erreur: {e}")
        return

    if global_config.get("use_id_cache", True):
        cache.load_id_cache()

    try:
        api_client = ApiClient(
            base_url=global_config.get('api_base_url', ''),
            global_headers=global_config.get('global_headers', {})
        )
    except ValueError as e:
        log.error(f"ERREUR FATALE: Problème de configuration du client API. {e}")
        return

    # Exécuter chaque étape définie
    for step_config in global_config.get('integration_steps', []):
        step_name = step_config.get('name', 'Étape sans nom')
        log.info(f"\n--- Préparation de l'étape : {step_name} ---")
        
        if not step_config.get('enabled', True):
            log.info("  Étape désactivée dans la configuration.")
            continue
            
        # Vérification des dépendances avant de lancer l'étape
        if not _check_dependencies(step_config):
            continue
        
        # --- MODIFICATION CLÉ ---
        # On passe maintenant la configuration globale à chaque appel de run_integration_step.
        # Cela permet aux fonctions plus profondes (comme resolve_placeholder) d'y avoir accès
        # pour gérer les lookups à la volée.
        core.run_integration_step(step_config, api_client, global_config, fail_fast)
    
    log.info("\n--- Synchronisation terminée. ---")

def start_generator(config_path: str, output_dir: str):
    """
    Orchestre la génération de modèles Excel (logique pour la commande 'template').
    """
    log.info("==============================================")
    log.info("=             API Seeder v1.5              =")
    log.info("=            Mode: Générateur de Modèles     =")
    log.info("==============================================")

    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
    except Exception as e:
        log.error(f"ERREUR FATALE: Impossible de lire '{config_path}'. Erreur: {e}")
        return
        
    generator.generate_templates(config, output_dir)


def cli_entry_point():
    """
    Point d'entrée pour la commande en ligne avec sous-commandes.
    """
    parser = argparse.ArgumentParser(
        prog="api-seeder",
        description="API Seeder: Outil de synchronisation de données et de génération de modèles via API.",
        epilog="Utilisez 'api-seeder <commande> --help' pour plus d'informations sur une commande."
    )
    subparsers = parser.add_subparsers(dest="command", required=True, help="Action à effectuer")

    # Sous-commande pour la synchronisation
    parser_sync = subparsers.add_parser("sync", help="Lance la synchronisation des données vers l'API.")
    parser_sync.add_argument("config", help="Chemin vers le fichier de configuration JSON.")
     # ON ATTACHE LE FLAG DIRECTEMENT À "parser_sync"
    parser_sync.add_argument(
        "--fail-fast",
        action="store_true",
        help="Arrête l'exécution du script à la première erreur rencontrée."
    )

    # Sous-commande pour la génération de templates
    parser_template = subparsers.add_parser("template", help="Génère la structure de dossiers et les fichiers Excel vides basés sur la configuration.")
    parser_template.add_argument("config", help="Chemin vers le fichier de configuration JSON à analyser.")
    parser_template.add_argument("--output", "-o", default="./templates_excel", help="Dossier de sortie (défaut: ./templates_excel).")
   
    

    args = parser.parse_args()

    # Redirection vers la bonne fonction en fonction de la commande
    if args.command == "sync":
        start_seeder(args.config, args.fail_fast)
    elif args.command == "template":
        start_generator(args.config, args.output)

if __name__ == '__main__':
    cli_entry_point()