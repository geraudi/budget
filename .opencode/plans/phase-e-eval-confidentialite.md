# Plan Phase E — Éval & confidentialité

> Plan opérationnel autonome pour une session neuve.
> Parent : `.opencode/plans/coach-financier-ia.md` (§8 scénarios, §9 vérification).
> État de départ : phases A à D terminées, phase D commitée `e771ecd`.
> Statut : phase E implémentée, vérifiée et commitée le 2026-11-02 (`9d02c27`).
> Dernière mise à jour : 2026-11-02.

---

## 0. Reprise en une minute

**Ne pas refaire les phases A à D.** Le coach fonctionne déjà de bout en bout :
indicateurs vérifiés, RAG lexical, objectifs persistés côté serveur, recommandations
journalisées, carte dashboard. `pnpm test:unit` passe à **182 tests / 17 fichiers**.

La phase E ne livre **aucune fonctionnalité métier**. Elle doit :

1. rendre l'évaluation des 10 scénarios de la §8 **reproductible hors ligne** via
   `pnpm test:coach` ;
2. prouver par un **test bloquant** qu'aucune donnée bancaire sensible (libellé
   commerçant, référence, libellé d'opération, `topExpenses`, id d'opération) ne fuit
   dans le payload coach ou le journal de recommandations ;
3. mettre la documentation à jour sans promettre de mémoire serveur du transcript
   (D.5 n'est **pas** fait).

Contraintes non négociables :

- base `.db/budget.dev.db` uniquement ; `.db/budget.prod.db` interdit en lecture comme
  en écriture ;
- `getContext()` côté serveur, jamais le singleton `db` ;
- UI et données en français, EUR via `Intl.NumberFormat` ;
- TanStack AI/Router **exact-pinned**, ne pas bumper ;
- **aucun schéma nouveau** sans nécessité : `pnpm db:generate` doit répondre
  « No schema changes » ;
- `pnpm events:verify` doit rester à **0 différence** ;
- ne rien commiter sans demande explicite de l'utilisateur.

---

## 1. Décisions verrouillées

| Sujet | Décision |
|---|---|
| Nature de l'éval | **Déterministe et hors ligne** : on teste le contexte, le prompt, les directives et les chiffres, pas la prose du modèle. |
| Modèle | Aucun appel Ollama dans `pnpm test:coach`. Un mode `--live` optionnel existe pour l'inspection manuelle, jamais requis par la CI. |
| Scénarios | Exactement les **10** de la §8 du plan parent, définis comme fixtures typées. |
| Confidentialité | Audit **bloquant** dans `test:unit` + `test:coach` : liste noire de chaînes et de clés JSON. |
| Transcript | Toujours `localStorage` par période. Ne jamais documenter une persistance serveur. |
| Schéma | Aucune migration E. Si un besoin apparaît, s'arrêter et le justifier avant d'écrire. |
| Documentation | `AGENTS.md`, `README.md`, `docs/coach-financier-ia.md` + section « Reprise » du plan parent. |

---

## 2. Périmètre

| # | Livrable | Dépend de |
|---|---|---|
| **E.1** | Fixtures des 10 scénarios + runner pur | — |
| **E.2** | Script `pnpm test:coach` (+ `--live` optionnel) et test Vitest | E.1 |
| **E.3** | Audit payload / journal / sources | E.2 |
| **E.4** | Documentation factuelle | E.1–E.3 |
| **Option** | Édition en masse `kind`/`nature`, éval RAG 50 questions | E.1–E.4 |

Ne pas commencer par l'optionnel. Si E.1–E.4 ne sont pas verts, l'option ne compte
pas.

---

## 3. État actuel utile

| Fichier | Rôle |
|---|---|
| `src/domain/analytics/types.ts` | `AnalyticsIndicators`, `AnalyticsOperation`, `AnalyticsPeriod` |
| `src/domain/analytics/index.ts` | `computeIndicators`, `computeDataQuality` |
| `src/lib/coach-prompt.ts` | `buildCoachPayload`, `buildGoalPayload`, `buildCoachSystemPrompt` (règles 1–10, directives `dataQuality`, directives objectifs) |
| `src/application/queries/coach.ts` | `buildCoachContext` → `{ indicators, goals, sources, knowledgeBlock }` |
| `src/application/queries/goals.ts` | `computeGoalProgress`, `listGoalProgress`, `toGoalCoachView`, `buildRecommendationPayload` |
| `src/domain/knowledge/search.ts` | `searchKnowledge(entries, query, { limit })`, `formatKnowledgeContext(matches)` |
| `src/domain/knowledge/parse.ts` | `parseKnowledgeFiles(files)` |
| `src/domain/goals/recommendation.ts` | `CoachRecommendationPayload` (contrat du journal) |
| `src/application/commands/record-recommendation.ts` | `recordRecommendation` (journal append-only) |
| `src/lib/coach.test.ts` | Tests existants du prompt (à ne pas dupliquer) |
| `src/application/queries/coach.test.ts` | Tests existants du contexte (DB en mémoire) |
| `src/test/helpers.ts` | `createTestContext()` (SQLite mémoire + migrations) |
| `scripts/knowledge-eval.ts` | Modèle de script CLI avec args, table et code de sortie |
| `vitest.config.ts` | `include: ['src/**/*.test.ts']`, environnement `node` |

Rappels de contrat :

- `income.total` n'est **pas** « les revenus » ; les revenus qualifiés sont
  `income.recurring + income.other`.
- `savings.observed` peut être négatif ; la capacité mensuelle est
  `savings.observed / dataQuality.monthsAvailable`.
- Un objectif atteint renvoie `realistic = false` avec `reasons = ['achieved']` ;
  l'UI masque le badge « irréaliste ».
- Le payload coach et le journal ne contiennent **que des agrégats** et, pour les
  objectifs, l'`id` et le libellé **saisis par l'utilisateur**. Aucun libellé bancaire.
- `goalDirectives` et `qualityDirectives` ne sont pas exportées : les tester via
  `buildCoachSystemPrompt`, qui est l'API publique.

---

## 4. E.1 — Fixtures des 10 scénarios

Créer `src/eval/coach/scenarios.ts`. Aucun accès disque, aucune DB, aucun modèle.

```ts
import type { AnalyticsIndicators } from '#/domain/analytics'
import type { GoalCoachView } from '#/application/queries/goals'

export type CoachScenario = {
  id: string
  title: string
  question: string
  indicators: AnalyticsIndicators
  goals?: GoalCoachView[]
  /** Sous-chaînes devant apparaître dans le prompt + bloc RAG. */
  expect: string[]
  /** Sous-chaînes interdites (fuite, conclusion non permise). */
  forbid?: string[]
  /** Fiche attendue dans le top 4 du RAG lexical. */
  expectSourceId?: string
}
```

Fournir une fixture de base complète et un helper `makeIndicators(overrides)` qui
fusionne aussi `dataQuality`. Ne pas importer les fixtures de `src/lib/coach.test.ts` :
elles sont privées au test et doivent rester stables.

### Les 10 scénarios

| `id` | Question | Signaux à construire | Attentes déterministes |
|---|---|---|---|
| `budget-equilibre` | « Comment améliorer mon épargne ? » | revenus qualifiés 3 000 €, essentielles 1 200 €, discrétionnaires 900 €, épargne observée 900 €, 12 mois | payload exact, pas de directive 50/30/20, fiche `epargne_automatisation` (top 1 vérifié le 2026-11-01) |
| `charges-essentielles` | « Où réduire mes dépenses ? » | essentielles / revenus qualifiés > 0,5 | « reconnais les contraintes » |
| `depense-exceptionnelle` | « Mes dépenses ont augmenté ce mois-ci. » | `expenses.exceptional = 800` | le montant exceptionnel apparaît, pas de conclusion de tendance |
| `depenses-recurrentes` | « Comment auditer mes abonnements ? » | `recurring.count = 5`, `monthlyTotal = 450`, `byCategory` | `450`, fiche `depenses_abonnements_audit` |
| `historique-incomplet` | « Puis-je dégager une tendance ? » | `monthsAvailable = 3` + avertissement | « interdit de tirer une conclusion de tendance » |
| `objectif-precis` | « Je veux mettre 120 €/mois pour des vacances. » | capacité 120 €/mois, objectif réaliste 1 440 € sur 12 mois | `120`, bloc « Objectifs suivis », réaliste |
| `solde-negatif` | « Comment épargner alors que je suis à découvert ? » | `savings.observed < 0`, `rate < 0` | « stabilisation du budget » |
| `question-50-30-20` | « Explique-moi la règle 50/30/20. » | `unqualifiedIncomeShare = 0.9` | « interdit d’appliquer ou de citer la règle 50/30/20 », fiche `budget_50_30_20` |
| `hors-perimetre` | « Quel ETF acheter ? » | indicateurs neutres | règle 7 : « aucun conseil en investissement » |
| `virements-internes` | « Mes virements faussent-ils mon budget ? » | `internalTotal > 0`, `detectedPairs = 0` | « virements internes », « fausser le solde net » |

Pour `objectif-precis`, construire un `GoalCoachView` complet (mêmes champs que
`src/lib/coach.test.ts`) : `monthlyEffort = 120`, `observedMonthlyCapacity = 120`,
`alternativeMonthlyEffort = 120`, `realistic = true`, `reasons = []`.

Ajouter éventuellement un scénario de **refus d'objectif irréaliste** dans les tests
Vitest existants, mais il ne remplace pas les 10 ci-dessus.

---

## 5. E.2 — Runner et `pnpm test:coach`

### Fichiers

```text
src/eval/coach/scenarios.ts      # fixtures pures
src/eval/coach/load.ts           # lit les .md et appelle parseKnowledgeFiles
src/eval/coach/run.ts            # évalue un scénario, retourne un résultat typé
src/eval/coach/run.test.ts       # 10 tests Vitest (it.each) → inclus dans test:unit
scripts/coach-eval.ts            # CLI : table, --scenario, --live, exit code
```

### `run.ts`

Signature indicative :

```ts
export type ScenarioResult = {
  id: string
  title: string
  ok: boolean
  failures: string[]
  matches: KnowledgeMatch[]
}

export function runScenario(
  scenario: CoachScenario,
  entries: KnowledgeEntry[],
): ScenarioResult
```

Implémentation :

```ts
const matches = searchKnowledge(entries, scenario.question, { limit: 4 })
const knowledgeBlock = formatKnowledgeContext(matches)
const prompt = buildCoachSystemPrompt(
  scenario.indicators,
  scenario.goals ?? [],
)
const full = [prompt, knowledgeBlock].filter(Boolean).join('\n\n')
```

Vérifier :

- chaque `expect` est inclus dans `full` ;
- chaque `forbid` est absent ;
- `expectSourceId` est dans `matches.map((m) => m.entry.id)` ;
- `buildCoachPayload(scenario.indicators)` est bien inclus dans le prompt ;
- si `goals` est non vide, `buildGoalPayload(goals)` est inclus.

Ne pas tester la prose du modèle. Ne pas appeler `fetch`. Ne pas ouvrir SQLite.

### `load.ts`

Lire uniquement `src/content/knowledge/*.md`, appeler `parseKnowledgeFiles`, retourner
les entrées triées par `id` pour un résultat stable. Utiliser
`fileURLToPath(new URL('../../content/knowledge/', import.meta.url))` depuis
`src/eval/coach/load.ts`, ou un chemin résolu depuis la racine du dépôt. Ne pas lire
`embeddings.json` : l'éval est lexicale.

### `scripts/coach-eval.ts`

Modèle : `scripts/knowledge-eval.ts` (lecture d'arguments, table, `process.exitCode`).

- `pnpm test:coach` → exécute les 10 scénarios, affiche `✓`/`✗`, le détail des
  échecs, puis `10/10 scénarios OK` ; code de sortie 1 si un scénario échoue.
- `pnpm test:coach -- --scenario=objectif-precis` → un seul scénario.
- `pnpm test:coach -- --live` → exécute d'abord l'éval hors ligne, puis envoie chaque
  prompt à Ollama et affiche la réponse. **Aucune assertion sémantique** en live :
  objectif = inspection manuelle. Vérifier qu'Ollama répond, sinon message clair et
  code de sortie 1.
- `--help` documente les options.

Ajouter dans `package.json` :

```json
"test:coach": "tsx scripts/coach-eval.ts"
```

Ne pas l'ajouter à `test:unit` : `run.test.ts` couvre déjà les mêmes vérifications.
`test:unit` doit rester rapide (< 5 s sur la base actuelle).

### Mode live (optionnel, jamais CI)

Utiliser `fetch` direct sur `${OLLAMA_HOST ?? 'http://localhost:11434'}/api/chat` :

```ts
{
  model: 'qwen3:14b',
  stream: false,
  options: { temperature: 0.3, num_predict: 600 },
  messages: [
    { role: 'system', content: `${prompt}\n\n${knowledgeBlock}` },
    { role: 'user', content: scenario.question },
  ],
}
```

Afficher `message.content`, pas de parsing Markdown, pas d'écriture en base. Prévenir
que `qwen3:14b` peut dépasser plusieurs minutes localement ; ne pas mettre de timeout
caché qui ferait échouer la CI (le mode live n'y tourne pas).

### `run.test.ts`

```ts
describe('coach scenarios §8', () => {
  it.each(SCENARIOS)('$id', (scenario) => {
    const result = runScenario(scenario, entries)
    expect(result.failures).toEqual([])
  })
})
```

Charger les entrées une seule fois (`beforeAll`) pour éviter 10 lectures disque.

---

## 6. E.3 — Audit confidentialité bloquant

Créer `src/eval/coach/privacy.test.ts`. Il utilise la **vraie** chaîne de calcul et la
**vraie** DB en mémoire, pas seulement des fixtures.

### Montage

1. `createTestContext()` + `afterEach` ferme la DB.
2. Insérer une catégorie et importer une opération via `OperationImported` (reprendre
   le pattern de `src/application/queries/coach.test.ts`) avec des marqueurs uniques :
   - `libelleSimplifie = 'PHARMACIE SECRETE 42'`
   - `libelleOperation = 'CARTE PHARMACIE SECRETE 42'`
   - `reference = 'REF-SECRET-42'`
   - `infosComplementaires = 'Carte 1234'`
3. Classifier en `expense` / `essential` (ou laisser la règle par défaut, mais vérifier
   le résultat).
4. `buildCoachContext(ctx, { from, to, question: '' })`.
5. Sérialiser :
   - `buildCoachPayload(context.indicators)`
   - `buildGoalPayload(context.goals)`
   - `buildCoachSystemPrompt(context.indicators, context.goals)`
   - `context.knowledgeBlock`
   - `JSON.stringify(context.sources)`
   - `JSON.stringify(buildRecommendationPayload({ period, indicators, progress, goal }))`
6. Écrire une recommandation avec `recordRecommendation`, relire la ligne
   `coach_recommendations` et sérialiser `payload`.

### Liste noire

Chaque chaîne sérialisée doit être exempte de :

```text
PHARMACIE
SECRETE
REF-SECRET-42
Carte 1234
libelleSimplifie
libelleOperation
infosComplementaires
reference
topExpenses
merchant
operationId
operations
```

Attention : `operations` peut apparaître dans un texte de documentation ou une clé
légitime ; adapter la liste à un motif précis (`"operations"` comme clé JSON) plutôt
qu'à une sous-chaîne trop large. Le test doit rester lisible et sans faux positif.

Vérifier aussi :

- le prompt contient bien les agrégats attendus (montant de la dépense, catégorie
  « Alimentation » ou « Santé », `dataQuality.monthsAvailable`) ;
- `context.sources` ne contient que `id`, `title`, `source`, `reviewRequired` ;
- le payload de recommandation contient `schemaVersion`, `period`, `indicators`,
  `goals`, `recommendedMonthlyEffort`, `rationale` et rien d'autre ;
- aucun `id` d'opération n'apparaît : les seuls `id` autorisés sont ceux des objectifs,
  saisis côté application.

Ajouter un test statique simple : aucun `console.log` / `console.error` dans
`src/lib/coach.ts`, `src/application/queries/coach.ts`, `src/server/goals.ts` ne
sérialise le payload ou les messages. Si un log existe, il ne doit contenir que des
compteurs/identifiants de requête.

### Critère

Le test doit échouer si quelqu'un ajoute `libelleSimplifie`, `topExpenses` ou une
référence d'opération au payload. C'est un garde-fou, pas un audit manuel.

---

## 7. E.4 — Documentation

### `AGENTS.md`

Ajouter une section courte « Objectifs & recommandations » :

- migration `0009`, tables `financial_goals` et `coach_recommendations` ;
- streams `goal:<id>`, projector inline, `appendGoalAndProject`, replay par
  `streamType` ;
- commandes `createGoal` / `updateGoal` / `recordGoalContribution` /
  `recordRecommendation` / `loadGoal`, server fns dans `src/server/goals.ts` ;
- journal append-only : jamais de mise à jour/suppression ;
- `pnpm test:coach` (hors ligne, `--live` optionnel) ;
- règle de confidentialité : payload agrégé uniquement, jamais de libellé bancaire.

Mettre à jour la section « Unit tests » avec `pnpm test:coach` et le nombre de tests.

### `README.md`

Ajouter :

- un paragraphe « Objectifs & recommandations » dans l'architecture ;
- `pnpm test:coach` dans les commandes de test ;
- le rappel que le transcript reste local par période (pas de mémoire serveur) ;
- le principe de minimisation : indicateurs agrégés + objectifs saisis, pas
  d'opérations ni de commerçants.

Ne pas réécrire l'architecture existante ; ajouter sans contredire.

### `docs/coach-financier-ia.md`

Document source de conception : ne pas réécrire les sections 1–10. Ajouter à la fin
une section « Implémentation dans budget-app (2026-11-01) » avec :

- phases A–D livrées et leur commit ;
- ce qui est réellement envoyé au modèle (payload agrégé, objectifs, fiches) ;
- ce qui n'est **pas** envoyé (libellés, références, ids d'opération, `topExpenses`) ;
- transcript local par période, D.5 non fait ;
- commande `pnpm test:coach` et nature de l'éval (déterministe hors ligne).

### Plan parent

Mettre à jour la section « Reprise de session » : phase E terminée, hash du commit,
nombre de tests, commandes vérifiées, prochaine étape éventuelle (optionnels ou D.5).

---

## 8. Vérifications et critères d'acceptation

À exécuter dans cet ordre :

```bash
pnpm exec tsc --noEmit
pnpm test:unit                 # 182 + scénarios + audit, tous verts
pnpm test:coach                # 10/10 hors ligne, sans Ollama ni DB
pnpm build
pnpm db:generate               # « No schema changes »
pnpm events:verify             # 0 différence sur .db/budget.dev.db
```

Optionnel, manuel :

```bash
pnpm test:coach -- --live      # inspection Ollama, non bloquant
```

Critères :

- [x] `pnpm test:coach` fonctionne **sans** Ollama et **sans** base de données.
- [x] Les 10 scénarios §8 sont couverts et un scénario qui perd sa directive échoue.
- [x] L'audit confidentialité est bloquant dans `test:unit` et `test:coach`.
- [x] Aucun schéma modifié, `db:generate` silencieux.
- [x] `events:verify` à 0 différence.
- [x] La doc ne prétend nulle part que le transcript est serveur.
- [x] Aucun commit sans demande explicite.

---

## 9. Pièges

- **Ne pas tester la prose du modèle hors ligne.** On teste le prompt, les chiffres,
  les directives et les sources. Le live est une inspection, pas une assertion.
- **Ne pas dupliquer les tests de `src/lib/coach.test.ts`.** Les scénarios sont des
  cas de bout en bout du prompt ; les tests unitaires existants restent la référence
  des règles isolées.
- **Le RAG lexical est déterministe mais sensible aux mots.** Si une fiche attendue
  n'apparaît pas, vérifier la question et les synonymes avant de changer le moteur.
- **`operations` est un mot trop courant** pour une liste noire naïve. Cibler les
  clés JSON et les marqueurs uniques.
- **Le libellé d'objectif est autorisé** : c'est une saisie utilisateur, pas une
  donnée bancaire. Ne pas l'interdire.
- **Les objectifs atteints** ont `realistic = false` avec `reasons = ['achieved']` :
  ne pas « corriger » ce contrat en phase E.
- **`schemaVersion`** du payload et des indicateurs ne change pas.
- **Latence Ollama** : ne jamais l'ajouter à la CI ni à `test:unit`.
- **`.db/budget.prod.db`** : interdit, même en lecture pour un audit.

---

## 10. Prompt de reprise pour une session neuve

Coller tel quel :

> Reprends `.opencode/plans/phase-e-eval-confidentialite.md` et implémente la
> **phase E (éval & confidentialité)** du coach financier. Lis aussi la section
> « Reprise de session » de `.opencode/plans/coach-financier-ia.md`.
>
> Les phases A à D sont terminées et commitées (`e771ecd`). Ne les refais pas. Ne
> commit rien sans demande explicite.
>
> Livrables : fixtures des 10 scénarios §8 + runner déterministe hors ligne
> (`src/eval/coach/`), script `pnpm test:coach` avec `--live` optionnel, audit
> bloquant du payload coach et du journal `coach_recommendations`, mise à jour de
> `AGENTS.md`, `README.md` et `docs/coach-financier-ia.md`.
>
> Contraintes : `.db/budget.dev.db` uniquement (`.db/budget.prod.db` interdit),
> `getContext()`, français/EUR, TanStack exact-pinned, aucun schéma nouveau
> (`pnpm db:generate` → « No schema changes »), `pnpm events:verify` à 0 différence,
> transcript toujours local (D.5 non fait).
>
> Vérifie avec `pnpm exec tsc --noEmit`, `pnpm test:unit`, `pnpm test:coach`,
> `pnpm build`, `pnpm db:generate`, `pnpm events:verify`. Termine en mettant à jour la
> section « Reprise de session » du plan parent.
