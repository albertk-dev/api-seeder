# src/api_seeder/utils.py

import re
from typing import Any, Set

def get_dependencies_from_mapping(mapping: Any) -> Set[str]:
    """
    Analyse récursivement un mapping (dict, list, str) pour trouver
    tous les noms d'étapes parentes dans les placeholders.
    Ex: Trouve "Chargement Modèles Unités" dans "${Chargement Modèles Unités.id:col}"
    """
    dependencies = set()
    
    if isinstance(mapping, dict):
        for value in mapping.values():
            dependencies.update(get_dependencies_from_mapping(value))
    elif isinstance(mapping, list):
        for item in mapping:
            dependencies.update(get_dependencies_from_mapping(item))
    elif isinstance(mapping, str):
        # Utilise une regex pour trouver tous les placeholders dans une chaîne
        # findall renvoie une liste de tuples, ex: [('Etape1', 'col1'), ('Etape2', 'col2')]
        matches = re.findall(r"\$\{(\w[^:]+)\.id:(\w+)\}", mapping)
        for match in matches:
            dependencies.add(match[0]) # On ne garde que le nom de l'étape parente
            
    return dependencies