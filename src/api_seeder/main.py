# src/api_seeder/main.py

import os
import json
import argparse
from . import core
from . import cache
from .api_client import ApiClient

def start_seeder(config_path: str):
    """
    Point d'entrée logique, orchestre l'intégration à partir du fichier de configuration.
    """
    print("==============================================")
    print("=             API Seeder v1.1              =")
    print("==============================================")
    
    # Se place dans le répertoire du fichier de config pour que les chemins relatifs fonctionnent
    config_dir = os.path.dirname(os.path.abspath(config_path))
    os.chdir(config_dir)
    config_filename = os.path.basename(config_path)

    try:
        with open(config_filename, 'r', encoding='utf-8') as f:
            config = json.load(f)
    except Exception as e:
        print(f"ERREUR FATALE: Impossible de lire le fichier de configuration '{config_filename}'. Erreur: {e}")
        return

    # Charger le cache d'ID si l'option est activée (elle l'est par défaut)
    if config.get("use_id_cache", True):
        cache.load_id_cache()

    try:
        # Initialiser le client API
        api_client = ApiClient(
            base_url=config.get('api_base_url', ''),
            global_headers=config.get('global_headers', {})
        )
    except ValueError as e:
        print(f"ERREUR FATALE: Problème de configuration du client API. {e}")
        return

    # Exécuter chaque étape définie dans le fichier de configuration
    for step_config in config.get('integration_steps', []):
        core.run_integration_step(step_config, api_client)
    
    print("\n--- Ensemencement terminé. ---")

def cli_entry_point():
    """
    Point d'entrée pour la commande en ligne défini dans pyproject.toml.
    """
    parser = argparse.ArgumentParser(description="API Seeder: Outil de synchronisation de données via API.")
    parser.add_argument("config", help="Chemin vers le fichier de configuration JSON du projet.")
    args = parser.parse_args()
    start_seeder(args.config)

if __name__ == '__main__':
    # Cette condition permet au script d'être exécutable directement
    cli_entry_point()