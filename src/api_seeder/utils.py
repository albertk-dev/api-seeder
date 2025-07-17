# src/api_seeder/utils.py 

import re
from typing import Any, Set, Dict, Optional

def get_dependencies_from_mapping(mapping: Any) -> Set[str]:
    # ... (code inchangé) ...
    dependencies = set()
    if isinstance(mapping, dict):
        for value in mapping.values():
            dependencies.update(get_dependencies_from_mapping(value))
    elif isinstance(mapping, list):
        for item in mapping:
            dependencies.update(get_dependencies_from_mapping(item))
    elif isinstance(mapping, str):
        matches = re.findall(r"\$\{(\w[^:]+)\.id:(\w+)\}", mapping)
        for match in matches:
            dependencies.add(match[0])
    return dependencies

# --- NOUVELLE FONCTION AJOUTÉE ICI ---
def extract_entity_from_response(response_data: Any, config: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Extrait le premier objet entité depuis une réponse d'API, en gérant
    les formats paginés, les tableaux directs et les objets directs.
    """
    data_path = config.get("lookup_response_data_path")
    results = response_data
    if data_path and data_path != "." and isinstance(response_data, dict):
        results = response_data.get(data_path)

    if isinstance(results, list):
        return results[0] if results else None
    elif isinstance(results, dict):
        return results
    return None