# src/api_seeder/api_client.py (version finale)

import requests
import json
from typing import Dict, Any, Optional
from .logger import log

class ApiClient:
    """Une classe pour gérer toutes les requêtes à l'API de manière centralisée."""

    def __init__(self, base_url: str, global_headers: Dict[str, str]):
        if not base_url: raise ValueError("L'URL de base de l'API ne peut pas être vide.")
        self.base_url = base_url
        self.headers = {**global_headers, 'Content-Type': 'application/json'}

    def get_entity(self, endpoint: str, params: Dict[str, Any]) -> requests.Response:
        """Effectue une requête GET pour rechercher une ou plusieurs entités."""
        url = f"{self.base_url.rstrip('/')}/{endpoint.lstrip('/')}"
        log.info(f"  -> REQUÊTE GET: {url}")
        log.debug(f"     Params: {params}")
        return requests.get(url, headers=self.headers, params=params, timeout=20)

    def create_entity(self, endpoint: str, payload: Dict[str, Any], params: Optional[Dict[str, Any]] = None) -> requests.Response:
        """
        Effectue une requête POST pour créer une entité.
        Peut maintenant inclure des paramètres dans l'URL.
        """
        url = f"{self.base_url.rstrip('/')}/{endpoint.lstrip('/')}"
        
        # --- LOGGING ---
        log.info(f"  -> REQUÊTE POST: {url}")
        if params:
            log.debug(f"     Params: {params}")
        log.debug(f"     Payload: {json.dumps(payload, indent=2, ensure_ascii=False)}")
        
        # --- MODIFICATION ---
        # On passe le dictionnaire `params` directement à requests
        return requests.post(url, data=json.dumps(payload), headers=self.headers, params=params, timeout=30)