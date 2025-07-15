# src/api_seeder/logger.py

import logging
import os

def setup_logger():
    """
    Configure et retourne un logger pour enregistrer les événements de l'application.
    Les logs seront écrits dans un fichier 'api_seeder.log' dans le répertoire de travail.
    """
    # Créer le logger principal
    logger = logging.getLogger('api_seeder')
    logger.setLevel(logging.DEBUG)  # Capture tous les niveaux de logs

    # Éviter d'ajouter plusieurs handlers si la fonction est appelée plusieurs fois
    if logger.hasHandlers():
        logger.handlers.clear()

    # Définir le chemin du fichier de log
    log_file_path = os.path.join(os.getcwd(), 'api_seeder.log')

    # Créer un handler pour écrire dans le fichier de log
    # 'w' pour écraser le fichier à chaque exécution, 'a' pour ajouter à la suite
    file_handler = logging.FileHandler(log_file_path, mode='w', encoding='utf-8')
    file_handler.setLevel(logging.DEBUG)  # N'écrire que les messages INFO et plus graves dans le fichier

    # Créer un handler pour afficher les messages dans la console
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.DEBUG)  # Afficher les messages INFO et plus graves dans la console

    # Définir le format des messages de log
    file_formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
    console_formatter = logging.Formatter('%(message)s') # Format plus simple pour la console

    file_handler.setFormatter(file_formatter)
    console_handler.setFormatter(console_formatter)

    # Ajouter les handlers au logger
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)

    return logger

# Créer une instance globale du logger pour pouvoir l'importer dans d'autres modules
log = setup_logger()