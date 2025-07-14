# src/api_seeder/cache.py

import json
import os
from typing import Dict, Any

# Ce dictionnaire en mémoire contiendra tous les ID.
# Il est initialisé vide et rempli par load_id_cache().
ID_STORE: Dict[str, Dict[str, str]] = {}
CACHE_FILENAME = ".id_cache.json"

def load_id_cache() -> None:
    """
    Charge le cache d'ID depuis le fichier .id_cache.json s'il existe.
    S'il n'existe pas ou est corrompu, initialise un cache vide.
    """
    if os.path.exists(CACHE_FILENAME):
        print(f"INFO: Cache d'ID trouvé. Chargement de '{CACHE_FILENAME}'...")
        try:
            with open(CACHE_FILENAME, 'r', encoding='utf-8') as f:
                global ID_STORE
                ID_STORE = json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            print(f"AVERTISSEMENT: Impossible de lire le fichier cache. Un nouveau sera créé. Erreur: {e}")
            ID_STORE = {}
    else:
        print("INFO: Aucun cache d'ID trouvé. Un nouveau sera créé.")
        ID_STORE = {}

def save_id_cache() -> None:
    """Sauvegarde le contenu actuel de ID_STORE dans le fichier cache .id_cache.json."""
    print(f"INFO: Sauvegarde du cache d'ID dans '{CACHE_FILENAME}'...")
    try:
        with open(CACHE_FILENAME, 'w', encoding='utf-8') as f:
            # indent=2 pour que le fichier soit lisible par un humain
            json.dump(ID_STORE, f, indent=2)
    except IOError as e:
        print(f"ERREUR: Impossible d'écrire dans le fichier cache '{CACHE_FILENAME}'. Erreur: {e}")

def get_id(step_name: str, lookup_value: str) -> str | None:
    """Récupère un ID spécifique depuis le cache en mémoire."""
    return ID_STORE.get(step_name, {}).get(lookup_value)

def store_id(step_name: str, lookup_value: str, new_id: str) -> None:
    """
    Stocke un nouvel ID dans le cache en mémoire.
    Initialise le dictionnaire de l'étape si nécessaire.
    """
    if step_name not in ID_STORE:
        ID_STORE[step_name] = {}
    ID_STORE[step_name][lookup_value] = new_id

def init_step_cache(step_name: str) -> None:
    """
    Prépare/réinitialise le cache pour une étape spécifique.
    Ceci est utile si une étape est relancée.
    """
    ID_STORE[step_name] = {}