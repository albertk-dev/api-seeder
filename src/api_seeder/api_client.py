# src/api_seeder/api_client.py

import requests
import json
from typing import Dict, Any

class ApiClient:
    """Une classe pour gérer toutes les requêtes à l'API de manière centralisée."""

    def __init__(self, base_url: str, global_headers: Dict[str, str]):
        """Initialise le client avec l'URL de base et les en-têtes globaux."""
        if not base_url:
            raise ValueError("L'URL de base de l'API ne peut pas être vide.")
        self.base_url = base_url
        self.headers = {**global_headers, 'Content-Type': 'application/json'}

    def get_entity(self, endpoint: str, params: Dict[str, Any]) -> requests.Response:
        """Effectue une requête GET pour rechercher une ou plusieurs entités."""
        url = f"{self.base_url.rstrip('/')}/{endpoint.lstrip('/')}"
        return requests.get(url, headers=self.headers, params=params, timeout=20)

    def create_entity(self, endpoint: str, payload: Dict[str, Any]) -> requests.Response:
        """Effectue une requête POST pour créer une entité."""
        url = f"{self.base_url.rstrip('/')}/{endpoint.lstrip('/')}"
        # Utilise json.dumps pour s'assurer que le payload est une chaîne JSON valide
        return requests.post(url, data=json.dumps(payload), headers=self.headers, timeout=30)