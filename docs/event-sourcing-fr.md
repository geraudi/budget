6# Les concepts de l’event sourcing, appliqués au Budget App

## Vue d’ensemble

L’application sépare maintenant deux mondes :

- **Le côté écriture (commands)** : on ne modifie plus directement la table `operations`. On enregistre des **événements** qui décrivent ce qui s’est passé.
- **Le côté lecture (queries)** : on lit une **projection**, c’est-à-dire une table SQL classique (`operations`) reconstruite à partir des événements.

C’est le principe du **CQRS** : Command Query Responsibility Segregation.

```text
Commande UI / import CSV
        │
        ▼
   Agrégat Operation  ──► décide les événements
        │
        ▼
   Event store (append-only)  ──► table `events`
        │
        ▼
   Projector (inline)  ──► met à jour la table `operations`
```

---

## 1. Événement (`event`)

Un **événement** est un **fait passé, immuable**. Il ne dit pas « modifie l’opération », il dit « voici ce qui vient de se produire ».

Dans ce projet, les événements sont définis dans `src/domain/operations/events.ts` :

| Événement | Signification |
| --- | --- |
| `OperationImported` | Une opération a été importée (ou reprise lors du backfill) |
| `OperationDetailsUpdated` | Certains champs ont changé |
| `OperationCategorized` | La catégorie / sous-catégorie a changé |
| `OperationPointageChanged` | Le pointage a changé |
| `OperationDeleted` | L’opération a été supprimée |

Exemple concret :

```json
{
  "type": "OperationPointageChanged",
  "payload": { "pointage": 1 },
  "metadata": {
    "source": "ui",
    "schemaVersion": 1,
    "commandId": "…",
    "correlationId": "…"
  }
}
```

Deux parties importantes :

- **`payload`** : les données métier utiles.
- **`metadata`** : des informations techniques (origine, version du schéma, empreinte, fichier importé…).

Un événement n’est **jamais modifié ni supprimé**. La table `events` est *append-only*.

---

## 2. Stream

Un **stream** est une **suite ordonnée d’événements concernant une même entité**.

Ici, une opération = un stream :

```text
operation:42
  v1  OperationImported
  v2  OperationCategorized
  v3  OperationPointageChanged
  v4  OperationDeleted
```

- L’identifiant du stream est `operation:<id>`.
- Chaque événement possède une **version de stream** (`stream_version`) : 1, 2, 3…
- La table `streams` stocke la version courante de chaque stream.

Cela permet notamment la **concurrence optimiste** : si deux commandes tentent d’écrire en même temps sur la version 3, la seconde échoue avec un conflit de version au lieu d’écraser silencieusement la première.

---

## 3. Agrégat (`aggregate`)

L’**agrégat** est l’objet métier qui décide quels événements produire.

Dans `src/domain/operations/operation.ts` :

- **`evolve(state, event)`** : applique un événement à l’état courant.
- **`foldOperation(events)`** : rejoue tous les événements d’un stream pour reconstruire l’état actuel.
- **`decideUpdate`, `decidePointage`, `decideDelete`** : regardent l’état et décident quels événements émettre.

Exemple :

```ts
decidePointage(state, 1)
// si state.pointage vaut déjà 1 → []
// sinon → [{ type: 'OperationPointageChanged', payload: { pointage: 1 } }]
```

Donc :

- **`decide*`** = « que doit-il se passer ? »
- **`evolve`** = « que devient l’état si cet événement arrive ? »

L’agrégat est **pur** : pas de SQL, pas d’accès à la base. C’est testable facilement.

---

## 4. Event store

L’**event store** est le composant qui persiste et relit les événements.
Fichier : `src/infrastructure/events/event-store.ts`.

Il expose notamment :

- `append(streamId, expectedVersion, events)` : ajoute des événements à un stream.
- `readStream(streamId)` : lit tous les événements d’un stream.
- `readAll(position)` : lit tous les événements dans l’ordre global.
- `nextId('operation')` : alloue un identifiant d’opération.
- `saveCheckpoint` / `getCheckpoint` : suit la position de la projection.

La table `events` contient :

```text
global_position  event_id  stream_id  stream_version  event_type  payload  metadata  occurred_at
```

`global_position` est l’ordre global d’écriture, tous streams confondus. C’est lui qui sert au rejeu complet.

---

## 5. Projection et read model

Une **projection** est une **vue optimisée pour la lecture**, reconstruite à partir des événements.

Ici, la projection est la table `operations` elle-même :

- Elle contient les colonnes utiles à l’UI.
- Elle est mise à jour par le projector.
- Elle peut être supprimée puis reconstruite intégralement depuis `events`.

C’est pour cela que `pnpm events:verify` peut :

1. copier la base,
2. vider `operations`,
3. rejouer tous les événements,
4. comparer avec l’original.

Si les deux sont identiques, la projection est fiable.

---

## 6. Projector

Le **projector** est le code qui transforme un événement en modification de la projection.
Fichier : `src/infrastructure/projections/operations.ts`.

Exemple simplifié :

```ts
case 'OperationImported':
  db.insert(operations).values({ id, ...payload })
  break

case 'OperationPointageChanged':
  db.update(operations).set({ pointage }).where(eq(operations.id, id))
  break

case 'OperationDeleted':
  db.delete(operations).where(eq(operations.id, id))
  break
```

Deux choix importants dans ce projet :

- **Projection inline** : le projector s’exécute dans la **même transaction SQLite** que l’ajout des événements. Pas de worker asynchrone, pas de délai de cohérence.
- **Suppression dure** : `OperationDeleted` supprime la ligne de `operations`, mais l’événement reste dans `events`. L’historique est donc conservé.

Le projector calcule aussi des champs dérivés :

- `fingerprint` : empreinte de déduplication ;
- `isRecurring` : correspondance avec les motifs récurrents.

Ces champs ne sont pas dans les événements : ce sont des conséquences de la projection.

---

## 7. Checkpoint

Un **checkpoint** indique jusqu’où la projection a traité les événements.

Table : `projection_checkpoints`

```text
name = 'operations'
position = 780
```

Cela permet de savoir que la projection a appliqué tous les événements jusqu’à la position globale 780. Aujourd’hui la projection est refaite en entier lors d’un rebuild, mais le checkpoint prépare une éventuelle projection incrémentale.

---

## 8. Séquence (`sequence`)

La table `sequences` alloue les identifiants métier :

```text
name = 'operation'
next_value = 781
```

Après le backfill des 780 opérations existantes, la prochaine opération importée recevra l’id `781`.

Cela permet de conserver des **IDs numériques** dans l’UI, sans migration vers des UUID.

---

## 9. Commandes et requêtes

### Command

Une **commande** exprime une intention d’écriture :

- `importOperations`
- `updateOperation`
- `setOperationPointage`
- `deleteOperation`

Elle :

1. ouvre une transaction,
2. recharge l’agrégat depuis ses événements,
3. appelle `decide*`,
4. ajoute les événements,
5. applique le projector,
6. valide la transaction.

Fichiers : `src/application/commands/`.

### Query

Une **requête** lit directement la projection, sans rejouer les événements :

- `listOperations`
- `getSimilarOperations`
- `getOperationHistory`
- `getCategories`

Fichiers : `src/application/queries/`.

C’est tout l’intérêt : les lectures restent simples et rapides, comme avant.

---

## 10. Backfill, verify, rebuild

### Backfill

`pnpm events:backfill`

Les 780 opérations qui existaient avant l’event sourcing sont transformées en **un événement `OperationImported` par opération**.

Cela permet de démarrer l’historique sans perdre les données existantes.

### Verify

`pnpm events:verify`

Rejoue tous les événements sur une **copie** de la base, puis compare la projection reconstruite avec l’originale.

Résultat actuel :

```text
Projection identique : 0 différence.
```

### Rebuild

`pnpm events:rebuild`

1. sauvegarde la base,
2. vide `operations`,
3. rejoue tous les événements,
4. recalcule les flags récurrents,
5. met à jour le checkpoint.

C’est la procédure de reconstruction complète de la projection.

---

## 11. Exemple complet : modifier le pointage

L’utilisateur coche la case « pointé » sur l’opération 42.

1. Le serveur reçoit `setOperationPointage({ id: 42, pointage: 1 })`.
2. La commande lit le stream `operation:42`.
3. `foldOperation` reconstruit l’état : l’opération existe, pointage actuel = 0.
4. `decidePointage` retourne :
   ```ts
   [{ type: 'OperationPointageChanged', payload: { pointage: 1 } }]
   ```
5. L’event store ajoute l’événement en version 2.
6. Le projector fait :
   ```sql
   UPDATE operations SET pointage = 1 WHERE id = 42;
   ```
7. La transaction est validée.
8. L’UI voit la ligne mise à jour immédiatement.

Si l’utilisateur décoche ensuite :

```text
operation:42
  v1 OperationImported
  v2 OperationPointageChanged { pointage: 1 }
  v3 OperationPointageChanged { pointage: 0 }
```

L’état actuel est toujours reconstruit en rejouant v1 → v2 → v3.

---

## 12. Pourquoi ce design ici ?

Avantages concrets :

- **Historique complet** : on peut afficher la timeline d’une opération.
- **Traçabilité** : on sait si une modification vient de l’UI, d’un import CSV ou du backfill.
- **Projection reconstructible** : `events:rebuild` peut réparer la table `operations`.
- **Tests plus simples** : l’agrégat est pur, le projector est testable, les commandes sont testables sur une base en mémoire.
- **Pas de changement UX** : l’UI continue de lire une table SQL classique avec des IDs numériques.

Coût / compromis :

- Plus de tables et plus d’indirections.
- Chaque écriture ajoute des événements en plus de mettre à jour la projection.
- Les données supprimées restent dans le journal d’événements.
- Les catégories, sous-catégories et règles récurrentes restent des **données de référence**, pas des agrégats event-sourcés.

---

## En résumé

| Concept | Rôle dans le projet |
| --- | --- |
| **Event** | Fait passé immuable (`OperationImported`, `OperationDeleted`…) |
| **Stream** | Suite ordonnée d’événements d’une opération (`operation:42`) |
| **Agrégat** | Reconstruit l’état et décide les événements |
| **Event store** | Persiste et relit les événements |
| **Projection** | Table `operations`, optimisée pour la lecture |
| **Projector** | Applique les événements à la projection |
| **Checkpoint** | Position traitée par la projection |
| **Sequence** | Allocation des IDs numériques |
| **Command** | Écrit via des événements |
| **Query** | Lit directement la projection |

Le principe central : **les événements sont la source de vérité, la table `operations` n’est qu’une conséquence reconstruisible de ces événements.**


---

## En résumé

| Concept | Rôle dans le projet |
| --- | --- |
| **Event** | Fait passé immuable (`OperationImported`, `OperationDeleted`…) |
| **Stream** | Suite ordonnée d’événements d’une opération (`operation:42`) |
| **Agrégat** | Reconstruit l’état et décide les événements |
| **Event store** | Persiste et relit les événements |
| **Projection** | Table `operations`, optimisée pour la lecture |
| **Projector** | Applique les événements à la projection |
| **Checkpoint** | Position traitée par la projection |
| **Sequence** | Allocation des IDs numériques |
| **Command** | Écrit via des événements |
| **Query** | Lit directement la projection |

Le principe central : **les événements sont la source de vérité, la table `operations` n’est qu’une conséquence reconstruisible de ces événements.**
