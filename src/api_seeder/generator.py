# src/api_seeder/generator.py (Version Corrigée)

import pandas as pd
import os
import re
from typing import Dict, Any, Set
from .logger import log
from .utils import get_dependencies_from_mapping # Import de la fonction partagée

def _extract_columns_from_mapping(mapping: Any) -> Set[str]:
    """
    Analyse récursivement un mapping pour extraire tous les noms de colonnes Excel requis.
    """
    columns = set()
    if isinstance(mapping, dict):
        if "source_column" in mapping: # Cas: Tableau simple depuis chaîne
            columns.add(mapping["source_column"])
        elif "link_column_parent" in mapping: # Cas: Tableau depuis fichier (colonne parent)
             columns.add(mapping["link_column_parent"])
             columns.update(_extract_columns_from_mapping(mapping.get("mapping", {})))
        else: # Cas: Objet imbriqué
            for value in mapping.values():
                columns.update(_extract_columns_from_mapping(value))
    elif isinstance(mapping, list):
        for item in mapping:
            columns.update(_extract_columns_from_mapping(item))
    elif isinstance(mapping, str) and not value.startswith('${'):
        # On suppose que c'est une colonne si ce n'est pas un placeholder
        columns.add(value)
    elif isinstance(mapping, str) and value.startswith('${'):
        # Extrait la colonne de lookup du placeholder, ex: 'colonne_lookup'
        match = re.search(r":(\w+)\}", value)
        if match:
            columns.add(match.group(1))
            
    return columns

def generate_templates(config: Dict[str, Any], output_dir: str):
    """
    Génère une structure de dossiers et de fichiers Excel vides
    basée sur le fichier de configuration.
    """
    log.info(f"--- Démarrage du générateur de modèles dans le dossier '{output_dir}' ---")
    
    files_to_generate: Dict[str, Set[str]] = {}

    # Parcourir chaque étape pour collecter les fichiers et leurs colonnes
    for step in config.get("integration_steps", []):
        # On ignore les étapes désactivées
        if not step.get("enabled", True):
            continue

        main_source_file = step.get("source_file")
        if not main_source_file: continue

        if main_source_file not in files_to_generate:
            files_to_generate[main_source_file] = set()
        
        # Ajouter les colonnes requises directement par l'étape
        if "lookup_key_column" in step:
            files_to_generate[main_source_file].add(step["lookup_key_column"])
        
        # Extraire les colonnes du payload et des request_params
        columns_from_payload = _extract_columns_from_mapping(step.get("payload_mapping", {}))
        columns_from_params = _extract_columns_from_mapping(step.get("request_params", {}))
        files_to_generate[main_source_file].update(columns_from_payload)
        files_to_generate[main_source_file].update(columns_from_params)
        
        # Extraire les colonnes des fichiers de liaison (pour les tableaux d'objets)
        def find_linked_files_recursively(mapping: Any):
            if isinstance(mapping, dict):
                if "source_file" in value and "link_column_child" in value:
                     linked_file = value["source_file"]
                     if linked_file not in files_to_generate:
                         files_to_generate[linked_file] = set()
                     files_to_generate[linked_file].add(value["link_column_child"])
                for v in mapping.values():
                    find_linked_files_recursively(v)
            elif isinstance(mapping, list):
                for item in mapping:
                    find_linked_files_recursively(item)

        find_linked_files_recursively(step.get("payload_mapping", {}))


    # Créer les dossiers et les fichiers Excel
    if not files_to_generate:
        log.info("Aucun fichier à générer trouvé dans la configuration.")
        return

    log.info("\nFichiers qui seront générés :")
    for file_path, columns in files_to_generate.items():
        # Retirer les valeurs None au cas où
        clean_columns = sorted([col for col in columns if col])
        if not clean_columns: continue

        log.info(f"- {file_path} (Colonnes: {', '.join(clean_columns)})")
        
        full_path = os.path.join(output_dir, file_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        
        df = pd.DataFrame(columns=clean_columns)
        df.to_excel(full_path, index=False)

    log.info(f"\nSuccès ! Les modèles Excel ont été générés dans le dossier '{output_dir}'.")