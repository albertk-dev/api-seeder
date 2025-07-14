# src/api_seeder/generator.py

import pandas as pd
import os
from typing import Dict, Any, Set

def _extract_columns_from_mapping(mapping: Dict[str, Any], columns: Set[str]) -> None:
    """
    Fonction récursive pour extraire les noms de colonnes d'un payload_mapping.
    """
    for key, value in mapping.items():
        if isinstance(value, str) and not value.startswith('${'):
            # C'est un mapping direct de colonne, mais on doit s'assurer que ce n'est pas une valeur statique.
            # Pour le générateur, on suppose que toute chaîne qui n'est pas un placeholder est une colonne.
            columns.add(value)
        elif isinstance(value, str) and value.startswith('${'):
            # C'est une dépendance, ex: ${Etape.id:colonne_de_lookup}
            placeholder_content = value.split(':')[1].strip('}')
            columns.add(placeholder_content)
        elif isinstance(value, dict):
            # C'est un sous-objet, on explore récursivement
            if "source_column" in value: # Cas: Tableau simple
                 columns.add(value["source_column"])
            elif "source_file" not in value: # Cas: Objet imbriqué
                _extract_columns_from_mapping(value, columns)

def generate_templates(config: Dict[str, Any], output_dir: str):
    """
    Génère une structure de dossiers et de fichiers Excel vides
    basée sur le fichier de configuration.
    """
    print(f"--- Démarrage du générateur de modèles dans le dossier '{output_dir}' ---")
    
    files_to_generate: Dict[str, Set[str]] = {}

    # Parcourir chaque étape pour collecter les fichiers et leurs colonnes
    for step in config.get("integration_steps", []):
        if not step.get("enabled", True):
            continue

        # Dictionnaire pour le fichier principal de l'étape
        main_source_file = step["source_file"]
        if main_source_file not in files_to_generate:
            files_to_generate[main_source_file] = set()
        
        # Ajouter les colonnes requises par l'étape elle-même
        if "lookup_key_column" in step:
            files_to_generate[main_source_file].add(step["lookup_key_column"])
        
        # Extraire récursivement les colonnes du payload_mapping
        if "payload_mapping" in step:
            _extract_columns_from_mapping(step["payload_mapping"], files_to_generate[main_source_file])

        # Gérer les fichiers de liaison pour les tableaux d'objets
        def find_linked_files(mapping: Dict[str, Any]):
            for key, value in mapping.items():
                if isinstance(value, dict):
                    if "source_file" in value:
                        linked_file = value["source_file"]
                        if linked_file not in files_to_generate:
                            files_to_generate[linked_file] = set()
                        
                        # Ajouter les colonnes de liaison
                        files_to_generate[main_source_file].add(value["link_column_parent"])
                        files_to_generate[linked_file].add(value["link_column_child"])
                        
                        # Extraire les colonnes du mapping interne du tableau
                        _extract_columns_from_mapping(value.get("mapping", {}), files_to_generate[linked_file])
                    else:
                        find_linked_files(value)
        
        if "payload_mapping" in step:
            find_linked_files(step["payload_mapping"])

    # Créer les dossiers et les fichiers Excel
    if not files_to_generate:
        print("Aucun fichier à générer trouvé dans la configuration.")
        return

    print("\nFichiers à générer :")
    for file_path, columns in files_to_generate.items():
        print(f"- {file_path} (Colonnes: {', '.join(sorted(list(columns)))})")
        
        full_path = os.path.join(output_dir, file_path)
        # Créer le dossier parent s'il n'existe pas
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        
        # Créer un DataFrame vide avec les bonnes colonnes et le sauvegarder
        df = pd.DataFrame(columns=sorted(list(columns)))
        df.to_excel(full_path, index=False)

    print(f"\nSuccès ! Les modèles Excel ont été générés dans le dossier '{output_dir}'.")