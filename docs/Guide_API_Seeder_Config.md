
### GUIDE COMPLET DE CONFIGURATION POUR API SEEDER (`config.json`)

#### **INTRODUCTION**

Le fichier `config.json` est le cœur de l'outil API Seeder. Il vous permet de décrire un processus d'intégration de données complexe sans écrire une seule ligne de code.

**Philosophie** : "Dis-moi ce que tu veux faire, pas comment le faire."

Ce guide explique chaque option disponible, des plus simples aux plus complexes.

---

#### **1. STRUCTURE GÉNÉRALE**

Le fichier `config.json` est un objet JSON qui contient 3 clés principales à sa racine :

```json
{
  "api_base_url": "https://votre-api.example.com/api",
  "global_headers": {
    "Authorization": "Bearer VOTRE_TOKEN_SECRET"
  },
  "integration_steps": [
    // ... La liste de vos étapes d'intégration vient ici ...
  ]
}
```

| Clé | Description | Obligatoire ? |
| :--- | :--- | :--- |
| `api_base_url` | L'URL de base de votre API. L'endpoint de chaque étape sera ajouté à la fin de cette URL. | **Oui** |
| `global_headers` | Un objet contenant les en-têtes HTTP à envoyer avec **chaque** requête. Parfait pour l'authentification. | Non |
| `integration_steps` | Un **tableau** d'objets où chaque objet représente une étape de chargement. **L'ordre des étapes dans ce tableau est crucial.** | **Oui** |

---

#### **2. ANATOMIE D'UNE ÉTAPE D'INTÉGRATION**

Chaque objet dans le tableau `integration_steps` est une tâche de chargement. Voici un aperçu de toutes les clés possibles :

```json
{
  "name": "Chargement Utilisateurs",
  "enabled": true,
  "source_file": "data/utilisateurs.xlsx",
  "endpoint": "/users",
  "method": "POST",
  "lookup_key_column": "email",
  "response_id_field": "id",
  "id_lookup_on_creation": {
    // ... configuration avancée ...
  },
  "payload_mapping": {
    // ... configuration du corps de la requête ...
  }
}
```

| Clé | Description | Obligatoire ? |
| :--- | :--- | :--- |
| `name` | **(Crucial)** Un nom unique et lisible pour l'étape. Il sert de **référence** pour les dépendances. | **Oui** |
| `enabled` | `true` ou `false`. Permet de désactiver temporairement une étape sans la supprimer. Idéal pour les tests. | Non (défaut: `true`) |
| `source_file` | Le chemin relatif (depuis `config.json`) vers le fichier Excel contenant les données. | **Oui** |
| `endpoint` | Le chemin de l'API pour cette ressource. Sera concaténé avec `api_base_url`. | **Oui** |
| `method` | La méthode HTTP à utiliser. Typiquement `POST` pour créer, `PUT` ou `PATCH` pour mettre à jour. | Non (défaut: `POST`) |
| `lookup_key_column` | La colonne du `source_file` contenant une valeur **unique** (ex: email, référence). | **Oui** (si l'étape est un parent) |
| `response_id_field` | Le nom du champ dans la **réponse JSON de l'API** qui contient l'ID unique que l'outil doit capturer. | **Oui** (si l'étape est un parent) |
| `id_lookup_on_creation` | **(Avancé)** Un objet pour configurer une recherche de secours si l'API ne renvoie pas l'ID directement. Voir section 4. | Non |
| `payload_mapping` | L'objet qui décrit comment construire le corps JSON de la requête. C'est la partie la plus importante. | **Oui** |

---

#### **3. LE GUIDE DU `payload_mapping` : CONSTRUIRE LE JSON**

C'est ici que vous définissez la structure exacte du corps de la requête (le payload) envoyé à l'API.

**Cas 1 : Mapping simple**  
*Objectif : La clé `emailAddress` du JSON prend la valeur de la colonne `email` de l'Excel.*

```json
"payload_mapping": {
  "emailAddress": "email"
}
```

**Cas 2 : Valeur statique**  
*Objectif : Ajouter un champ `source` qui a toujours la même valeur.*

```json
"payload_mapping": {
  "source": "InitialSeedingScript"
}
```

**Cas 3 : Objet imbriqué**  
*Objectif : Créer un objet `address` à l'intérieur du JSON principal.*

```json
"payload_mapping": {
  "address": {
    "street": "rue",
    "city": "ville",
    "country": "France"
  }
}
```

**Cas 4 : Tableau simple (depuis une chaîne de caractères)**  
*Objectif : Transformer la chaîne `coton,ete,bleu` de la colonne `tags` en un tableau JSON.*

```json
"payload_mapping": {
  "tags": {
    "source_column": "tags",
    "split_by": ","
  }
}
```

**Cas 5 : Dépendance (Récupérer un ID)**  
*Objectif : Injecter l'ID d'un utilisateur, créé à une étape précédente, dans un champ `userId`.*

```json
"payload_mapping": {
  "userId": "${Chargement Utilisateurs.id:email_client}"
}
```

> **Décryptage** : Le script prend la valeur de la colonne `email_client`, cherche l'ID associé dans la mémoire de l'étape `"Chargement Utilisateurs"`, et l'injecte.

**Cas 6 : Tableau d'Objets (Relation un-à-plusieurs)**  
*Objectif : Pour une commande, créer un tableau `items` en lisant les lignes correspondantes dans un autre fichier Excel.*

```json
"payload_mapping": {
  "items": {
    "source_file": "data/lignes_commande.xlsx",
    "link_column_parent": "ref_commande",
    "link_column_child": "ref_commande_parente",
    "mapping": {
      "productId": "${Chargement Produits.id:produit_sku}",
      "quantity": "quantite"
    }
  }
}
```

> Le script filtre `lignes_commande.xlsx` en utilisant les colonnes de lien, puis applique le `mapping` interne pour chaque ligne correspondante.

---

#### **4. CAS AVANCÉ : RÉCUPÉRATION D'ID VIA RECHERCHE**

**Problème** : Certaines API répondent à une création (`POST`) avec un succès mais **sans** renvoyer l'ID de l'objet créé.

**Solution** : API Seeder peut effectuer une seconde requête (`GET`) pour rechercher l'objet et récupérer son ID.

Ajoutez la section `id_lookup_on_creation` :

```json
"id_lookup_on_creation": {
  "enabled": true,
  "lookup_endpoint": "/users",
  "lookup_query_param": "email"
}
```

| Clé | Description | Obligatoire ? |
| :--- | :--- | :--- |
| `enabled` | Mettez à `true` pour activer cette logique de recherche. | Oui |
| `lookup_endpoint` | L'endpoint à interroger pour la recherche `GET`. | Oui |
| `lookup_query_param` | Le nom du paramètre de requête utilisé, sa valeur étant prise dans `lookup_key_column`. | Oui |

> Si la réponse du `POST` est vide, l'outil fera `/users?email=valeur` pour récupérer l'ID.

---

#### **5. ASTUCES ET BONNES PRATIQUES**

- **Validez votre JSON** : Utilisez un validateur en ligne (comme JSONLint).
- **Procédez par étapes** : Testez une étape à la fois avant d'ajouter des dépendances.
- **Utilisez `"enabled": false`** : Pour désactiver temporairement certaines étapes.
- **Vérifiez les noms de colonnes** : Ils doivent correspondre exactement à ceux des fichiers Excel.
- **Consultez les fichiers d'erreurs** : `erreurs_Nom_Etape.xlsx` indique les causes d’échec (souvent la réponse de l'API).
