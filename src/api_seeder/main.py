# src/api_seeder/main.py

import os
import json
import argparse
from . import core
from . import cache
from . import generator 
from .api_client import ApiClient

def start_seeder(config_path: str):
    """
    Orchestre la synchronisation des données (anciennement la fonction principale).
    """
    print("==============================================")
    print("=             API Seeder v1.2              =")
    print("=             Mode: Synchronisation          =")
    print("==============================================")
    
    config_dir = os.path.dirname(os.path.abspath(config_path))
    os.chdir(config_dir)
    config_filename = os.path.basename(config_path)

    try:
        with open(config_filename, 'r', encoding='utf-8') as f:
            config = json.load(f)
    except Exception as e:
        print(f"ERREUR FATALE: Impossible de lire le fichier de configuration '{config_filename}'. Erreur: {e}")
        return

    if config.get("use_id_cache", True):
        cache.load_id_cache()

    try:
        api_client = ApiClient(
            base_url=config.get('api_base_url', ''),
            global_headers=config.get('global_headers', {})
        )
    except ValueError as e:
        print(f"ERREUR FATALE: Problème de configuration du client API. {e}")
        return

    for step_config in config.get('integration_steps', []):
        core.run_integration_step(step_config, api_client)
    
    print("\n--- Synchronisation terminée. ---")


def start_generator(config_path: str, output_dir: str):
    """
    Orchestre la génération des modèles de fichiers.
    """
    print("==============================================")
    print("=             API Seeder v1.2              =")
    print("=             Mode: Générateur de Modèles    =")
    print("==============================================")

    # Le générateur n'a pas besoin de changer de répertoire, il utilise des chemins absolus.
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
    except Exception as e:
        print(f"ERREUR FATALE: Impossible de lire le fichier de configuration '{config_path}'. Erreur: {e}")
        return
        
    generator.generate_templates(config, output_dir)


def cli_entry_point():
    """
    Point d'entrée pour la commande en ligne, maintenant avec des sous-commandes.
    """
    parser = argparse.ArgumentParser(
        prog="api-seeder",
        description="API Seeder: Outil de synchronisation de données et de génération de modèles via API."
    )
    subparsers = parser.add_subparsers(dest="command", required=True, help="Action à effectuer")

    # Sous-commande pour la synchronisation
    parser_sync = subparsers.add_parser("sync", help="Lance la synchronisation des données vers l'API.")
    parser_sync.add_argument("config", help="Chemin vers le fichier de configuration JSON.")

    # Sous-commande pour la génération de templates
    parser_template = subparsers.add_parser("template", help="Génère la structure de dossiers et les fichiers Excel vides basés sur la configuration.")
    parser_template.add_argument("config", help="Chemin vers le fichier de configuration JSON à analyser.")
    parser_template.add_argument("--output", "-o", default="./templates_excel", help="Dossier où générer les modèles (défaut: ./templates_excel).")

    args = parser.parse_args()

    if args.command == "sync":
        start_seeder(args.config)
    elif args.command == "template":
        start_generator(args.config, args.output)

if __name__ == '__main__':
    cli_entry_point()