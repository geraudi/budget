# Anonymisation de la base

`scripts/anonymize-db.mjs` produit une copie anonymisée de la base SQLite du
Budget App, utilisable pour une démo, des captures d'écran ou un rapport de bug.
La base source n'est jamais modifiée, sauf si `--in-place` est explicitement
demandé.

## Commande

```bash
pnpm anonymize-db [options] [source] [destination]
```

Équivalent :

```bash
node scripts/anonymize-db.mjs [options] [source] [destination]
```

Valeurs par défaut :

- `source` : `$DATABASE_URL`, sinon `.db/budget.dev.db` ;
- `destination` : `.db/budget.anonymized.db`.

## Options

| Option | Description |
| --- | --- |
| `--in-place` | Anonymise directement la base source (aucune copie). Ne prend pas de `destination`. |
| `--force` | Écrase la destination si elle existe déjà. |
| `--seed <n>` | Graine du générateur aléatoire (défaut : `1`). Même graine ⇒ même résultat. |
| `-h`, `--help` | Affiche l'aide. |

## Exemples

```bash
# .db/budget.dev.db → .db/budget.anonymized.db
pnpm anonymize-db

# Exécution reproductible, en écrasant une copie précédente
pnpm anonymize-db --seed 42 --force

# Source et destination explicites
pnpm anonymize-db .db/budget.dev.db /tmp/budget.anon.db

# Anonymiser volontairement la base réelle sur place
pnpm anonymize-db --in-place
```

Pour lancer l'application sur la copie anonymisée :

```bash
DATABASE_URL=.db/budget.anonymized.db pnpm dev
```

## Données transformées

### Table `operations`

| Colonne | Transformation |
| --- | --- |
| `libelle_simplifie` | Libellé factice stable : `LIBELLÉ ANONYMISÉ 001`, `002`, … Une même valeur réelle garde toujours le même libellé factice. |
| `libelle_operation` | Libellé factice stable : `OPÉRATION ANONYMISÉE 001`, `002`, … |
| `infos_complementaires` | Libellé factice stable : `INFORMATION ANONYMISÉE 001`, `002`, … |
| `reference` | Caractères aléatoires de même longueur et de même classe (chiffre, majuscule, minuscule), séparateurs conservés. Le mappage est stable pour les références répétées. |
| `debit`, `credit`, `montant` | Facteur aléatoire unique par opération dans `[0,9 ; 1,1]`, arrondi au centime. L'invariant `montant = debit + credit` est conservé. |
| `fingerprint` | Recalculé avec le même algorithme que `src/lib/csv.ts` (si la colonne existe). |

Les cellules vides et les valeurs `NULL` restent vides.

### Tables de récurrence

- `recurring_operations.libelle_simplifie` et `.match_pattern` utilisent les
  mêmes libellés factices que les opérations ;
- `recurring_operations.montant` reçoit un facteur ±10 % ;
- `recurring_labels.pattern` devient `MOTIF ANONYMISÉ 001`, `002`, …

Le rapprochement des opérations récurrentes n'est plus significatif après
anonymisation (les motifs ne correspondent plus aux libellés), mais les flags
`is_recurring` existants sont laissés intacts.

## Données conservées

Le script ne touche pas aux données suivantes :

- dates (`date_comptabilisation`, `date_operation`, `date_valeur`) ;
- `type_operation`, catégories et sous-catégories ;
- `pointage` et `is_recurring` ;
- libellés des objectifs (`financial_goals`) et recommandations enregistrées
  (`coach_recommendations`) : ils ne contiennent pas de commerçant, mais peuvent
  contenir des intitulés personnels saisis par l'utilisateur ;
- **event store** (`events`, `streams`) : le script ne réécrit pas les
  événements.

## Limites et précautions

- **L'event store n'est pas anonymisé.** Si la base source contient des
  événements avec les vrais libellés, références ou montants, ces valeurs
  restent lisibles dans `events`. Un `pnpm events:rebuild` réinjecterait même
  les données d'origine dans la projection. Avant de partager une base,
  vérifiez donc le contenu de `events`, ou partez d'une base dont les événements
  ont été créés après anonymisation.
- Les montants varient de ±10 % seulement : un montant rare ou une date précise
  peut encore permettre de recouper une opération.
- Les empreintes (`fingerprint`) sont des hachés SHA-256 : elles ne révèlent pas
  directement les valeurs, mais restent corrélables avec une base connue.
- L'anonymisation ne garantit pas l'absence de données personnelles dans les
  colonnes libres ou les tables non citées ci-dessus.

## Fonctionnement interne

- La copie est réalisée avec `Database.backup()` de better-sqlite3, en lecture
  seule sur la source.
- Le générateur pseudo-aléatoire est un `mulberry32` amorcé par `--seed`, ce qui
  rend l'anonymisation reproductible.
- Les mises à jour sont exécutées dans des transactions.
- `secure_delete = ON` puis `VACUUM` sont appliqués pour éviter que les anciennes
  valeurs restent lisibles dans les pages SQLite libérées.
- Les fichiers `-wal` et `-shm` de la destination sont supprimés avant un
  écrasement avec `--force`.
- Le script vérifie la présence des tables et colonnes optionnelles
  (`fingerprint`, `match_pattern`, tables de récurrence) pour rester compatible
  avec les anciennes bases.
- Il refuse d'écrire dans la source sans `--in-place`, et refuse d'écraser une
  destination existante sans `--force`.
