# API seeder v1.0

Un outil en ligne de commande simple et puissant pour charger et intégrer des données depuis des fichiers Excel vers une API web. Il gère les dépendances complexes, les objets imbriqués et les tableaux d'objets grâce à un unique fichier de configuration `config.json`.

## Fonctionnalités

*   **Piloté par la configuration** : Pas de code à toucher. Décrivez votre intégration dans un fichier JSON.
*   **Gestion des dépendances** : Créez des entités (ex: des utilisateurs), récupérez leurs ID, et injectez-les automatiquement dans la création d'entités dépendantes (ex: des commandes).
*   **Structure de données complexe** : Mappez facilement les colonnes Excel vers des objets JSON imbriqués et des tableaux d'objets.
*   **Rapports d'erreurs** : Chaque enregistrement qui échoue est capturé dans un fichier Excel séparé pour analyse, avec la raison de l'échec.
*   **Autonome** : L'outil est un exécutable unique qui ne nécessite pas d'installation de Python ou de bibliothèques.

## Comment l'utiliser ?

1.  **Téléchargez** le dossier `.zip` de la dernière version et décompressez-le.
2.  **Copiez le dossier d'exemple** : Le dossier contient un exécutable `API seeder` et un dossier `examples`. Copiez le dossier `examples/premier_projet` et renommez-le pour votre propre projet.
3.  **Préparez vos données** : Remplissez ou remplacez les fichiers Excel dans le sous-dossier `data/` avec vos propres données.
4.  **Configurez l'intégration** : Ouvrez le fichier `config.json` et modifiez-le pour qu'il corresponde à votre API et à vos fichiers de données (voir le guide de configuration ci-dessous).
5.  **Lancez l'outil** : Ouvrez un terminal (ou `cmd` / `PowerShell` sur Windows), naviguez jusqu'à votre dossier de projet et lancez la commande :

    ```bash
    # Sur Windows
    .\API seeder.exe config.json

    # Sur macOS / Linux
    ./API seeder config.json
    ```

## Guide de Configuration (`config.json`)

Le fichier `config.json` est le cœur de l'outil. Voici la description de chaque champ.

### Structure Générale

```json
{
  "api_base_url": "https://votre-api.com/api",
  "global_headers": { "Authorization": "Bearer TOKEN" },
  "integration_steps": [ /* ... vos étapes ici ... */ ]
}
```
*   `api_base_url`: (Requis) L'URL de base de votre API.
*   `global_headers`: (Optionnel) En-têtes HTTP à envoyer avec chaque requête (ex: authentification).

### Structure d'une Étape (`integration_steps`)

C'est un tableau d'objets, exécutés dans l'ordre.

| Clé | Description | Exemple |
| :--- | :--- | :--- |
| `name` | **Requis.** Un nom unique pour l'étape. Sert de référence pour les dépendances. | `"Chargement Utilisateurs"` |
| `enabled` | `true` ou `false`. Permet de désactiver une étape sans la supprimer. | `true` |
| `source_file` | **Requis.** Chemin relatif vers le fichier Excel source. | `"data/utilisateurs.xlsx"` |
| `endpoint` | **Requis.** Le chemin de l'API pour cette ressource. | `"/users"` |
| `method` | La méthode HTTP à utiliser. | `"POST"` |
| `lookup_key_column`| **Crucial pour les dépendances.** Colonne du `source_file` contenant une valeur unique (ex: email, SKU). | `"email"` |
| `response_id_field`| **Crucial pour les dépendances.** Nom du champ dans la réponse de l'API qui contient l'ID à stocker. | `"id"` |
| `payload_mapping` | **Requis.** L'objet qui décrit comment construire le JSON envoyé à l'API. | `{...}` |

### Guide du `payload_mapping`

| Cas d'usage | Syntaxe dans `payload_mapping` | JSON Résultant |
| :--- | :--- | :--- |
| **Propriété simple** | `"api_key": "excel_column"` | `{ "api_key": "valeur_de_la_colonne" }` |
| **Valeur statique** | `"source": "MonScript"` | `{ "source": "MonScript" }` |
| **Objet imbriqué** | `"user": { "name": "nom", "city": "ville" }` | `{ "user": { "name": "...", "city": "..." } }` |
| **Dépendance (ID)** | `"userId": "${Nom Etape Parent.id:colonne_lookup}"` | `{ "userId": "id_recupere_de_l'etape_parent" }` |
| **Tableau simple**<br>(valeurs en `a,b,c`) | `"tags": { "source_column": "tags_col", "split_by": "," }` | `{ "tags": ["a", "b", "c"] }` |
| **Tableau d'objets** | `"items": { "source_file": "...", "link_column_parent": "...", "link_column_child": "...", "mapping": {...} }` | `{ "items": [ {..}, {..} ] }` |

---
## Pour les développeurs

Si vous voulez modifier le code source :

1.  Clonez le dépôt.
2.  Installez les dépendances : `pip install -e .`
3.  Lancez depuis la source : `python src/data_integrator/main.py examples/premier_projet/config.json`
4.  Reconstruisez l'exécutable : `pyinstaller --name API seeder --onefile --console src/data_integrator/main.py`