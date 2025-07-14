# GUIDE COMPLET DE CONFIGURATION POUR API SEEDER

## I. Introduction

Bienvenue dans le guide de **API Seeder**. Cet outil vous permet de synchroniser des données depuis des fichiers Excel vers l'API **PATNUC SIG** de manière intelligente et robuste.

### La Philosophie : Synchroniser, pas seulement Pousser

API Seeder est plus qu'un simple outil d'import. Il est conçu pour être **idempotent**, ce qui signifie que vous pouvez le lancer plusieurs fois avec les mêmes données sans créer de doublons ou causer d'erreurs. Il suit une logique simple mais puissante :

1. **Chercher** : Pour chaque ligne de votre fichier Excel, il vérifie d'abord si l'entité (une station, un équipement, etc.) existe déjà dans l'API.
2. **Agir** :
   - Si l'entité n'existe pas, il la **crée**.
   - Si l'entité existe déjà, il passe à la suite, évitant ainsi les erreurs de conflit (`409 Conflict`).
3. **Mémoriser** : Il capture l'ID de l'entité (qu'elle soit nouvelle ou existante) et le sauvegarde dans un cache pour l'utiliser dans les étapes dépendantes (par exemple, pour lier un équipement à sa station).

Ce document vous guidera à travers toutes les options de configuration pour maîtriser l'outil.

---

## II. Structure Globale du `config.json`

Le fichier `config.json` est le seul fichier que vous avez à modifier. Il est composé de sections principales à sa racine.

### Exemple de structure de base

```json
{
  "api_base_url": "http://localhost:8080/api",
  "global_headers": {
    "Authorization": "Bearer VOTRE_TOKEN_API_JWT"
  },
  "use_id_cache": true,
  "integration_steps": [
    // ... La liste de vos étapes de synchronisation vient ici ...
  ]
}
```

### Paramètres de configuration

| Clé | Description | Obligatoire ? |
|:----|:------------|:-------------|
| `api_base_url` | L'URL de base de votre API. L'endpoint de chaque étape sera ajouté à la fin de cette URL. | **Oui** |
| `global_headers` | Un objet contenant les en-têtes HTTP à envoyer avec **chaque** requête. Parfait pour l'authentification. | Non |
| `use_id_cache` | Si `true`, l'outil sauvegarde les ID trouvés dans un fichier `.id_cache.json`. Cela permet les exécutions en plusieurs fois et la reprise sur erreur. **Il est fortement recommandé de le laisser à `true`**. | Non (défaut: `true`) |
| `integration_steps` | Un **tableau** d'objets où chaque objet représente une étape de synchronisation. **L'ordre des étapes dans ce tableau est crucial.** | **Oui** |

---

## III. Anatomie d'une Étape (`integration_steps`)

Chaque objet dans le tableau `integration_steps` est une tâche de synchronisation. Voici toutes les clés qui la définissent.

### Paramètres d'une étape

| Clé | Description | Obligatoire ? |
|:----|:------------|:-------------|
| `name` | **(Crucial)** Un nom unique et lisible pour l'étape. Il sert de **référence** pour les dépendances. | **Oui** |
| `enabled` | `true` ou `false`. Permet de désactiver temporairement une étape. Idéal pour les tests. | Non (défaut: `true`) |
| `mode` | Définit le comportement de l'étape : `"sync"` (défaut) ou `"lookup_only"`. | Non (défaut: `"sync"`) |
| `source_file` | Le chemin relatif (depuis `config.json`) vers le fichier Excel contenant les données. | **Oui** |
| `endpoint` | Le chemin de l'API pour **créer** une ressource (ex: `/stations`). Utilisé uniquement en mode `sync`. | **Oui** (en mode `sync`) |
| `lookup_key_column` | La colonne du `source_file` contenant une valeur **unique** (ex: email, référence) pour identifier chaque enregistrement. | **Oui** |
| `response_id_field` | Le nom du champ dans la réponse JSON de l'API qui contient l'ID unique que l'outil doit capturer. | **Oui** |
| `id_lookup_config` | **(Crucial)** Un objet qui définit **comment chercher** une entité. | **Oui** |
| `payload_mapping` | L'objet qui décrit comment construire le corps JSON pour la **création** d'une entité. | **Oui** (en mode `sync`) |

---

## IV. Modes d'Exécution et Configuration de la Recherche

### Mode `"sync"` (par défaut)

- **Logique** : Pour chaque ligne Excel → Cherche l'entité. Si elle n'existe pas, la crée.
- **Cas d'usage** : Chargement initial, ajout de nouvelles données, relances sécurisées.

#### Exemple de configuration `sync`

```json
{
  "name": "Synchronisation Technologies",
  "mode": "sync",
  "source_file": "data/parametrage/technologies.xlsx",
  "endpoint": "/technologies",
  "lookup_key_column": "nom_technologie",
  "response_id_field": "id",
  "id_lookup_config": {
    "lookup_endpoint": "/technologies",
    "lookup_query_param": "search"
  },
  "payload_mapping": {
    "name": "nom_technologie",
    "description": "description_technologie",
    "activitySector": "secteur_activite"
  }
}
```

### Mode `"lookup_only"` (Recherche Seule)

- **Logique** : Pour chaque ligne Excel → Cherche l'entité, récupère son ID, et le met en cache. **Ne crée jamais rien.**
- **Cas d'usage** : Les opérateurs existent déjà en base de données. On veut juste charger leurs stations sans risquer de recréer les opérateurs.

#### Exemple de configuration `lookup_only`

```json
{
  "name": "Découverte Opérateurs",
  "mode": "lookup_only",
  "source_file": "data/operateurs/organisations.xlsx",
  "lookup_key_column": "nom_organisation",
  "response_id_field": "id",
  "id_lookup_config": {
    "lookup_endpoint": "/organizations",
    "lookup_query_param": "filter.name"
  }
}
```

---

## V. Le Guide Ultime du `payload_mapping` (avec Exemples)

Cette section est le cœur de votre configuration. Elle est utilisée uniquement en mode `"sync"` pour construire le corps JSON de la requête de création.

### Cas 1 : Mapping Simple

**Objectif** : Associer directement une colonne Excel à une clé JSON.

**Fichier `technologies.xlsx`** :

| nom_technologie | description_technologie |
|:----------------|:----------------------|
| Fibre Optique | Connexion par fibre optique... |

**Configuration** :
```json
"payload_mapping": {
  "name": "nom_technologie",
  "description": "description_technologie"
}
```

**JSON généré** :
```json
{
  "name": "Fibre Optique",
  "description": "Connexion par fibre optique..."
}
```

---

### Cas 2 : Valeur Statique

**Objectif** : Ajouter des champs au JSON qui ont toujours la même valeur, non issue de l'Excel.

**Fichier `organisations.xlsx`** :

| nom_organisation |
|:----------------|
| Opérateur A |

**Configuration** :
```json
"payload_mapping": {
  "name": "nom_organisation",
  "organizationType": "OPERATOR",
  "activitySector": ["TELECOMMUNICATION"]
}
```

**JSON généré** :
```json
{
  "name": "Opérateur A",
  "organizationType": "OPERATOR",
  "activitySector": ["TELECOMMUNICATION"]
}
```

---

### Cas 3 : Objet Imbriqué

**Objectif** : Créer un objet JSON à l'intérieur du payload principal.

**Fichier `utilisateurs.xlsx`** :

| prenom | nom |
|:-------|:----|
| Jean | Dupont |

**Configuration** (hypothétique, si votre API attendait un objet `contact`) :
```json
"payload_mapping": {
  "contactDetails": {
    "firstName": "prenom",
    "lastName": "nom"
  }
}
```

**JSON généré** :
```json
{
  "contactDetails": {
    "firstName": "Jean",
    "lastName": "Dupont"
  }
}
```

---

### Cas 4 : Tableau Simple (depuis une chaîne de caractères)

**Objectif** : Transformer une chaîne de caractères (ex: `TELECOMMUNICATION,TRANSPORT`) en un tableau JSON.

**Fichier `organisations.xlsx`** :

| nom_organisation | secteurs_activite |
|:----------------|:------------------|
| Opérateur B | TELECOMMUNICATION,TRANSPORT |

**Configuration** :
```json
"payload_mapping": {
  "name": "nom_organisation",
  "activitySector": {
    "source_column": "secteurs_activite",
    "split_by": ","
  }
}
```

**JSON généré** :
```json
{
  "name": "Opérateur B",
  "activitySector": ["TELECOMMUNICATION", "TRANSPORT"]
}
```

---

### Cas 5 : Dépendance (Récupérer un ID du Cache)

**Objectif** : Créer une station qui dépend d'une `localité` et d'une `organisation`, dont les ID ont été trouvés à des étapes précédentes.

**Fichier `stations.xlsx`** :

| nom_station | code_localite | nom_proprietaire |
|:-----------|:--------------|:-----------------|
| Antenne-Paris-01 | 75056 | Opérateur A |

**Configuration** :
```json
"payload_mapping": {
  "name": "nom_station",
  "localityId": "${Chargement Localités.id:code_localite}",
  "organizationId": "${Découverte Opérateurs.id:nom_proprietaire}"
}
```

**Logique** :
1. Le script résout `${Chargement Localités.id:code_localite}` en trouvant l'ID associé à `75056`.
2. Il résout `${Découverte Opérateurs.id:nom_proprietaire}` en trouvant l'ID associé à `Opérateur A`.

**JSON généré** (avec des ID d'exemple) :
```json
{
  "name": "Antenne-Paris-01",
  "localityId": 101,
  "organizationId": 55
}
```

---

### Cas 6 : Tableau d'Objets (Relation un-à-plusieurs)

**Objectif** : Créer une liaison (`connection`) qui contient un tableau de points GPS (`path`), en se basant sur un second fichier Excel.

**Fichiers Excel** :

- `liaisons.xlsx`:

| nom_liaison |
|:-----------|
| LIA-PAR-LYO-01 |

- `chemins_gps.xlsx`:

| ref_liaison | index_point | latitude | longitude |
|:-----------|:------------|:---------|:----------|
| LIA-PAR-LYO-01 | 0 | 48.85 | 2.35 |
| LIA-PAR-LYO-01 | 1 | 47.21 | 3.98 |
| LIA-PAR-LYO-01 | 2 | 45.76 | 4.83 |

**Configuration** :
```json
"payload_mapping": {
  "name": "nom_liaison",
  "path": {
    "source_file": "data/chemins_gps.xlsx",
    "link_column_parent": "nom_liaison",
    "link_column_child": "ref_liaison",
    "mapping": {
      "index": "index_point",
      "latitude": "latitude",
      "longitude": "longitude",
      "name": "ref_liaison"
    }
  }
}
```

**JSON généré** :
```json
{
  "name": "LIA-PAR-LYO-01",
  "path": [
    { "index": "0", "latitude": "48.85", "longitude": "2.35", "name": "LIA-PAR-LYO-01" },
    { "index": "1", "latitude": "47.21", "longitude": "3.98", "name": "LIA-PAR-LYO-01" },
    { "index": "2", "latitude": "45.76", "longitude": "4.83", "name": "LIA-PAR-LYO-01" }
  ]
}
```

---

### Cas 7 : Tableau de Valeurs Simples (Tableau d'IDs)

**Objectif** : Créer un équipement et lui assigner une liste d'ID de technologies, à partir d'un fichier de liaison.

**Fichiers Excel** :

- `equipements.xlsx`:

| nom_equipement |
|:---------------|
| Antenne-5G-Paris |

- `liaison_equipement_techno.xlsx` (fichier de liaison):

| nom_equipement_parent | nom_technologie |
|:---------------------|:----------------|
| Antenne-5G-Paris | 5G |
| Antenne-5G-Paris | 4G LTE |

**Configuration** :
```json
"payload_mapping": {
  "name": "nom_equipement",
  "technologyIds": {
    "source_file": "data/liaison_equipement_techno.xlsx",
    "link_column_parent": "nom_equipement",
    "link_column_child": "nom_equipement_parent",
    "mapping": {
      "_placeholder": "${Synchronisation Technologies.id:nom_technologie}"
    }
  }
}
```

**Logique (la magie du `_placeholder`)** :
Le script voit `"_placeholder"` et comprend qu'il doit créer un tableau de valeurs simples. Pour chaque ligne du fichier de liaison, il résout la dépendance et ajoute l'ID résultant à une liste.

**JSON généré** (avec des ID d'exemple) :
```json
{
  "name": "Antenne-5G-Paris",
  "technologyIds": [22, 15]
}
```