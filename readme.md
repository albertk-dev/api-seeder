# API Seeder v1.2

Un outil en ligne de commande puissant pour synchroniser des données depuis des fichiers Excel vers une API web. Il est conçu pour être robuste, relançable et gérer des dépendances complexes.

## Fonctionnalités Clés

*   **Philosophie de Synchronisation** : L'outil cherche les entités avant de les créer, évitant les doublons et gérant les erreurs `409 Conflict` intelligemment.
*   **Piloté par la Configuration** : Toute la logique d'intégration est décrite dans un unique fichier `config.json`. Pas de code à modifier pour de nouvelles intégrations.
*   **Gestion des Dépendances Complexes** : Capture les ID des entités parentes et les injecte automatiquement dans les entités enfants, même à travers plusieurs exécutions grâce à un cache.
*   **Rapports d'Erreurs Détaillés** : Chaque enregistrement qui échoue est capturé dans un fichier Excel, incluant la **ligne exacte** du fichier source et la réponse d'erreur de l'API.
*   **Générateur de Modèles** : Une sous-commande pour générer automatiquement la structure de dossiers et les fichiers Excel vides, prêts à être remplis.
*   **Modes Flexibles** : Utilisez le mode `sync` pour créer et mettre à jour, ou le mode `lookup_only` pour découvrir des données préexistantes sans les modifier.

---

## Guide d'Utilisation

### 1. Installation et Préparation

1.  **Téléchargez** le dossier `.zip` de la dernière version et décompressez-le.
2.  **Copiez le dossier d'exemple** : Le dossier contient l'exécutable `API-Seeder` et un dossier `examples`. Copiez le dossier `examples/mon_premier_seeding` et renommez-le pour votre propre projet.
3.  **Préparez vos données** : Remplissez ou remplacez les fichiers Excel dans le sous-dossier `data/` avec vos propres données.
4.  **Configurez l'intégration** : Ouvrez le fichier `config.json` et modifiez-le pour qu'il corresponde à votre API et à vos fichiers. (Un guide de configuration complet est disponible dans le dossier `docs/`).

### 2. Lancer la Synchronisation

Ouvrez un terminal (ou `cmd` / `PowerShell` sur Windows), naviguez jusqu'au dossier de votre projet et lancez la commande `sync`.

```bash
# Sur Windows
.\API-Seeder.exe sync chemin\vers\votre\config.json

# Sur macOS / Linux
./API-Seeder sync chemin/vers/votre/config.json
```

### 3. Outil d'Aide : Générateur de Modèles Excel

Pour démarrer un nouveau projet rapidement et sans erreurs, utilisez le générateur de modèles. Il lit votre `config.json` et crée automatiquement la structure de dossiers et les fichiers Excel vides, avec les bonnes colonnes.

#### Comment l'utiliser ?

Lancez la commande `template` en fournissant le chemin vers votre fichier de configuration.

```bash
# Utilisation de base (génère dans un dossier nommé "templates_excel")
./API-Seeder template chemin/vers/votre/config.json

# Spécifier un dossier de sortie personnalisé
./API-Seeder template chemin/vers/votre/config.json --output ./mes_fichiers_excel
```

---

## Pour les Développeurs

Cette section est pour ceux qui souhaitent modifier ou étendre le code source de API Seeder.

### 1. Mise en Place de l'Environnement

Le projet utilise un environnement virtuel pour gérer ses dépendances de manière isolée.

```bash
# 1. Clonez le dépôt Git
git clone <url_du_depot>
cd api-seeder

# 2. Créez l'environnement virtuel
python -m venv venv

# 3. Activez l'environnement
# Sur Windows:
# .\venv\Scripts\activate
# Sur macOS/Linux:
source venv/bin/activate

# 4. Installez le projet et ses dépendances en mode "éditable"
# Cette commande lit pyproject.toml et crée la commande "api-seeder"
pip install -e .
```

### 2. Lancer depuis le Code Source

Une fois l'environnement mis en place, vous pouvez lancer les commandes directement. Assurez-vous que votre environnement virtuel `(venv)` est activé.

```bash
# Lancer une synchronisation
api-seeder sync examples/mon_premier_seeding/config.json

# Lancer le générateur de modèles
api-seeder template examples/mon_premier_seeding/config.json -o ./output_test
```

### 3. Structure du Code

Le code est segmenté en modules avec des responsabilités claires dans le dossier `src/api_seeder/` :

*   `main.py`: Point d'entrée de la CLI, gère les sous-commandes et l'orchestration de haut niveau.
*   `core.py`: Contient la logique principale de synchronisation pour une étape (`run_integration_step`).
*   `payload.py`: Responsable de la construction récursive du payload JSON.
*   `cache.py`: Gère la lecture et l'écriture du cache d'ID (`.id_cache.json`).
*   `api_client.py`: Centralise tous les appels HTTP `requests`.
*   `generator.py`: Contient la logique pour le générateur de modèles.

### 4. Reconstruire l'Exécutable

Si vous avez apporté des modifications et que vous souhaitez packager une nouvelle version de l'exécutable autonome :

1.  Assurez-vous que votre environnement virtuel est activé.
2.  Installez PyInstaller : `pip install pyinstaller`.
3.  Lancez la commande de construction depuis la **racine** du projet :

    ```bash
    pyinstaller --name API-Seeder --onefile --console src/api_seeder/main.py
    ```

Le nouvel exécutable se trouvera dans le dossier `dist/`.