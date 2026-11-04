# Plan Phase D — Objectifs & suivi

> Plan parent : `.opencode/plans/coach-financier-ia.md`
> Statut : terminée, vérifiée et commitée (`e771ecd`)
> Branche : `archi-cqrs`
> Dernière mise à jour : 2026-11-02

---

## 0. Reprise en une minute

Les phases **A, B et C sont terminées et vérifiées**. Ne pas les refaire.

| Élément | État au démarrage |
|---|---|
| Commits | `d9378dc` (phase B), `c416f06` (phase C) — locaux, non poussés |
| Arbre de travail | propre (`git status --short` vide) |
| Tests | `pnpm test:unit` → **119 tests / 13 fichiers** |
| Base de travail | `.db/budget.dev.db` uniquement |
| Base interdite | `.db/budget.prod.db` (lecture **et** écriture) |
| Modèle | Ollama `qwen3:14b` (lent : > 15 s, parfois plusieurs minutes) |
| Indicateurs de contrôle | revenus qualifiés **3 385,05 €**, `savings.rate = -10,0789`, 3 avertissements |
| Event store | 780 opérations / 788 événements, `pnpm events:verify` à 0 différence |

**Objectif de la phase D** : passer d'indicateurs ponctuels à un **suivi d'objectifs**
persisté côté serveur, repris par le coach à chaque période.

**Critère d'acceptation** : sur deux périodes successives, le coach produit un effort
mensuel réaliste (« 120 €/mois ») puis suit la contribution (« 24 € sur 30 € »), en
refusant un objectif supérieur à la capacité d'épargne observée.

---

## 1. Décisions verrouillées

1. **Objectifs event-sourcés** : `GoalCreated`, `GoalUpdated`,
   `GoalContributionRecorded` sur le stream `goal:<id>`, projection `financial_goals`.
   Les commandes passent par un helper `appendGoalAndProject` ; **jamais** d'écriture
   directe dans `financial_goals` hors projector / rebuild.
2. **Montants dérivés** : `savedAmount` est la somme des contributions, calculée par le
   projector. L'effort mensuel et la progression sont **calculés à la lecture**, jamais
   stockés (pas de dérive possible).
3. **Recommandations = journal immuable** : `coach_recommendations` n'est pas un
   agrégat event-sourcé. C'est une table append-only écrite par une commande dédiée,
   jamais supprimée par `events:rebuild`, jamais rejouée.
4. **Mémoire métier serveur en D** : objectifs + contributions + recommandations
   persistés en SQLite. C'est cette mémoire qui assure la continuité entre périodes.
5. **Transcript de chat** : reste en `localStoragePersistence` par période en D.
   La persistance serveur du transcript brut est un **stretch D.5** (voir § 10) :
   elle exige `@tanstack/ai-persistence` (non installé) et une route d'hydratation.
   Ne pas la mélanger à la migration `0009`.
6. **Aucun libellé bancaire dans le payload coach** : ni `libelleSimplifie`, ni
   `topExpenses`, ni nom de commerçant. Les libellés d'objectifs sont saisis par
   l'utilisateur ; ils ne doivent jamais être confondus avec des libellés d'opérations.
7. **Période** : `resolveCoachPeriod` reste la seule source de vérité ; `asOfMonth`
   pour l'effort = `period.to`. Ne jamais coder `2026-10` en dur.
8. **TanStack AI / Router restent exact-pinned**. Aucun bump pour faire passer un test.
9. **Migration générée** par `pnpm db:generate` ; ne jamais éditer le snapshot à la main.
10. **Pas de commit sans demande explicite.**

---

## 2. Périmètre

| Étape | Livrable | Dépend de |
|---|---|---|
| **D.1** | Schéma `financial_goals`, `coach_recommendations` + migration `0009` | — |
| **D.2** | Domaine + événements + commandes + projector des objectifs | D.1 |
| **D.3** | Requêtes `goals.ts` : progression, effort mensuel, capacité, réalisme | D.2 |
| **D.4** | Coach + dashboard : objectifs dans le contexte/prompt, carte de suivi, recommandations | D.3 |
| **D.5** | *(stretch)* transcript de chat serveur (`coach_threads` / `coach_messages`) | D.4 |

Hors périmètre D :

- édition en masse `kind`/`nature` dans `src/routes/index.tsx` (peut rester en phase E) ;
- jeu d'éval RAG à 50 questions ;
- branchement des embeddings/hybride ;
- investissement, fiscalité, droit.

---

## 3. Modèle de données (migration `0009`)

### 3.1 `financial_goals`

```ts
export const financialGoals = sqliteTable(
  "financial_goals",
  {
    // Fourni explicitement par la séquence `goal` : ne jamais laisser SQLite
    // l'auto-assigner, sinon la séquence et la projection divergent.
    id: integer("id").primaryKey(),
    label: text("label").notNull(),
    targetAmount: real("target_amount").notNull(),
    // Dérivé des GoalContributionRecorded, jamais écrit par une commande.
    savedAmount: real("saved_amount").notNull().default(0),
    targetMonth: text("target_month").notNull(), // YYYY-MM
    startMonth: text("start_month").notNull(), // YYYY-MM
    status: text("status", {
      enum: ["active", "paused", "achieved", "abandoned"],
    })
      .notNull()
      .default("active"),
    // Renseignés depuis event.occurredAt par le projector (rebuild déterministe).
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_goals_status").on(t.status),
    index("idx_goals_target_month").on(t.targetMonth),
  ],
)
```

Règles :

- `targetAmount > 0`, arrondi à 2 décimales.
- `targetMonth >= startMonth`.
- `initialSavedAmount >= 0` et `<= targetAmount` ; si égal, le projector crée
  directement l'objectif en `achieved`.
- `savedAmount` peut diminuer via une contribution négative (correction), mais jamais
  sous 0 : la commande refuse.
- Un objectif `paused` ou `abandoned` n'accepte plus de contribution.
- `achieved` est posé par la commande de contribution quand la cible est atteinte,
  ou par `GoalUpdated` si l'utilisateur rouvre explicitement l'objectif.

### 3.2 `coach_recommendations`

```ts
export const coachRecommendations = sqliteTable(
  "coach_recommendations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    periodFrom: text("period_from").notNull(),
    periodTo: text("period_to").notNull(),
    goalId: integer("goal_id").references(() => financialGoals.id, {
      onDelete: "set null",
    }),
    kind: text("kind", {
      enum: ["assessment", "goal_plan", "follow_up"],
    }).notNull(),
    payload: text("payload", { mode: "json" })
      .$type<CoachRecommendationPayload>()
      .notNull(),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    index("idx_coach_recommendations_period").on(t.periodFrom, t.periodTo),
    index("idx_coach_recommendations_goal").on(t.goalId),
  ],
)
```

`CoachRecommendationPayload` (type pur, dans `src/domain/goals/recommendation.ts`) :

```ts
export type CoachRecommendationKind = "assessment" | "goal_plan" | "follow_up"

export type CoachRecommendationPayload = {
  schemaVersion: 1
  period: { from: string; to: string }
  indicators: {
    income: { recurring: number; other: number; unqualified: number; total: number }
    expenses: {
      essential: number
      discretionary: number
      exceptional: number
      unqualified: number
      total: number
    }
    savings: { observed: number; rate: number }
    dataQuality: {
      monthsAvailable: number
      unqualifiedIncomeShare: number
      warnings: string[]
    }
  }
  goals: Array<{
    id: number
    label: string
    targetAmount: number
    savedAmount: number
    remaining: number
    targetMonth: string
    monthlyEffort: number
    observedMonthlyCapacity: number
    alternativeMonthlyEffort: number
    realistic: boolean
    reasons: string[]
  }>
  /** Effort recommandé pour le `goalId` visé, sinon capacité mensuelle observée. */
  recommendedMonthlyEffort: number | null
  /** Justifications déterministes, en français, sans libellé bancaire. */
  rationale: string[]
}
```

Contraintes :

- Le payload ne contient **que** des agrégats et des libellés d'objectifs.
- Aucun `libelleSimplifie`, `topExpenses`, `reference`, `libelleOperation`.
- Un test doit sérialiser le payload et vérifier l'absence de ces champs.

### 3.3 Ce que `0009` ne contient pas

- Pas de `coach_threads` / `coach_messages` : c'est D.5, migration `0010`.
- Pas de colonne `monthly_effort` : dérivée à la lecture.
- Pas de `goal_contributions` : les contributions se lisent depuis les événements du
  stream `goal:<id>` (peu d'objectifs). Si le nombre d'objectifs explose, ajouter une
  projection dédiée en phase E, pas maintenant.

---

## 4. Domaine et événements

### 4.1 Enveloppe d'événements partagée

Créer `src/domain/events/envelope.ts` :

```ts
export type EventMetadata = {
  commandId: string
  correlationId: string
  source: "csv-import" | "ui" | "backfill" | "system"
  schemaVersion: 1
  fingerprint?: string
  importId?: string
  fileName?: string
  legacyId?: number
}

export type NewEvent<TEvent extends { type: string; payload: unknown }> =
  TEvent & {
    eventId?: string
    occurredAt?: string
    metadata: EventMetadata
  }

export type StoredEvent<TEvent extends { type: string; payload: unknown }> =
  TEvent & {
    globalPosition: number
    eventId: string
    streamId: string
    streamType: string
    streamVersion: number
    occurredAt: string
    metadata: EventMetadata
  }
```

Puis :

- `src/domain/operations/events.ts` ré-exporte `EventMetadata` et définit
  `NewOperationEvent = NewEvent<OperationEvent>`,
  `StoredOperationEvent = StoredEvent<OperationEvent>`.
- `src/domain/goals/events.ts` fait de même pour `GoalEvent`.
- `src/domain/events/index.ts` expose `AnyEvent = OperationEvent | GoalEvent` et
  `AnyStoredEvent = StoredEvent<AnyEvent>`.

Ne pas déplacer `OperationEvent` : les imports existants doivent continuer à compiler.

### 4.2 Types d'objectif

`src/domain/goals/types.ts` :

```ts
export type GoalStatus = "active" | "paused" | "achieved" | "abandoned"

export type GoalDetails = {
  label: string
  targetAmount: number
  targetMonth: string // YYYY-MM
  startMonth: string // YYYY-MM
  initialSavedAmount: number
}

export type GoalPatch = Partial<{
  label: string
  targetAmount: number
  targetMonth: string
  status: GoalStatus
}>

export type GoalState = Omit<GoalDetails, "initialSavedAmount"> & {
  id: number
  savedAmount: number
  status: GoalStatus
  version: number
}
```

### 4.3 Événements

`src/domain/goals/events.ts` :

```ts
export type GoalEvent =
  | { type: "GoalCreated"; payload: GoalDetails }
  | { type: "GoalUpdated"; payload: GoalPatch }
  | {
      type: "GoalContributionRecorded"
      payload: { amount: number; month: string } // amount signé, month YYYY-MM
    }

export type NewGoalEvent = NewEvent<GoalEvent>
export type StoredGoalEvent = StoredEvent<GoalEvent>
```

### 4.4 Agrégat

`src/domain/goals/goal.ts` :

```ts
const STREAM_PREFIX = "goal:"

export function goalStreamId(id: number): string
export function goalIdFromStream(streamId: string): number
export function foldGoal(events: ReadonlyArray<StoredGoalEvent>): GoalState | null
export function evolve(state: GoalState | null, event: StoredGoalEvent): GoalState

export function decideCreate(details: GoalDetails): GoalEvent[]
export function decideUpdate(state: GoalState, patch: GoalPatch): GoalEvent[]
export function decideContribution(
  state: GoalState,
  input: { amount: number; month: string },
): GoalEvent[]
```

Comportement attendu :

- `evolve` sur `GoalCreated` : `savedAmount = initialSavedAmount`,
  `status = initialSavedAmount >= targetAmount ? "achieved" : "active"`.
- `evolve` sur `GoalContributionRecorded` : `savedAmount = round2(saved + amount)`.
- `decideCreate` : valide et renvoie un seul événement.
- `decideUpdate` : n'émet que les champs réellement modifiés ; si `targetAmount`
  augmente au-dessus de `savedAmount` alors que le statut était `achieved`, réouvre en
  `active` dans le même patch — sauf si le patch contient déjà un `status` explicite.
- `decideContribution` :
  - refuse `amount === 0`, mois invalide, objectif non `active`, résultat `< 0` ;
  - émet `GoalContributionRecorded` ;
  - si la cible est atteinte, ajoute `GoalUpdated { status: "achieved" }`.
- `decideUpdate` refuse `status: "achieved"` saisi à la main : `achieved` est dérivé
  d'une contribution. Les statuts manuels autorisés sont `active`, `paused`,
  `abandoned`.

### 4.5 Validation

Créer `src/domain/goals/validation.ts` (pur, testable sans SQLite) :

```ts
export function parseGoalMonth(value: unknown, label: string): string
export function validateGoalLabel(value: unknown): string
export function validateGoalAmount(value: unknown, label: string): number
export function validateGoalPatch(value: unknown): GoalPatch
export function validateContribution(value: unknown): { amount: number; month: string }
```

Messages en français, par exemple :

- `Libellé d’objectif requis (80 caractères max)`
- `Montant cible invalide (montant positif attendu)`
- `Mois cible invalide (format YYYY-MM attendu)`
- `Le mois cible doit être postérieur ou égal au mois de départ`
- `Une contribution ne peut pas rendre l’épargne négative`
- `Cet objectif n’accepte plus de contribution`

`round2` : créer `src/domain/goals/money.ts` avec
`export function round2(value: number): number` et l'utiliser dans le domaine, le
projector et les requêtes. Ne pas importer un helper privé de `indicators.ts`.

---

## 5. Infrastructure

### 5.1 Event store générique

`src/infrastructure/events/event-store.ts` doit accepter les deux agrégats sans
dupliquer la logique :

```ts
append<TEvent extends AnyEvent = OperationEvent>(
  streamId: string,
  streamType: string,
  expectedVersion: number,
  newEvents: ReadonlyArray<NewEvent<TEvent>>,
): StoredEvent<TEvent>[]

readStream<TEvent extends AnyEvent = OperationEvent>(
  streamId: string,
): StoredEvent<TEvent>[]

readAll<TEvent extends AnyEvent = AnyEvent>(
  fromPosition?: number,
  limit?: number,
): StoredEvent<TEvent>[]
```

- `toStoredEvent<TEvent>` caste `row.eventType as TEvent["type"]`.
- Les appels existants (`append`, `readStream` sans type) restent valides grâce aux
  paramètres par défaut.
- `src/infrastructure/projections/operations.test.ts` ligne ~158 utilise
  `ctx.projector.apply(ctx.events.readAll())` : remplacer par
  `ctx.events.readAll<OperationEvent>()` ou filtrer `streamType === "operation"`.

### 5.2 Projector des objectifs

Créer `src/infrastructure/projections/goals.ts` :

```ts
export function createGoalProjector(db: AppDb) {
  return {
    apply(events: ReadonlyArray<StoredGoalEvent>): void {
      for (const event of events) {
        const id = goalIdFromStream(event.streamId)
        switch (event.type) {
          case "GoalCreated":
            db.insert(financialGoals)
              .values({
                id,
                label: event.payload.label,
                targetAmount: event.payload.targetAmount,
                savedAmount: event.payload.initialSavedAmount,
                targetMonth: event.payload.targetMonth,
                startMonth: event.payload.startMonth,
                status:
                  event.payload.initialSavedAmount >= event.payload.targetAmount
                    ? "achieved"
                    : "active",
                createdAt: event.occurredAt,
                updatedAt: event.occurredAt,
              })
              .run()
            break
          case "GoalUpdated":
            db.update(financialGoals)
              .set({ ...event.payload, updatedAt: event.occurredAt })
              .where(eq(financialGoals.id, id))
              .run()
            break
          case "GoalContributionRecorded": {
            const current = db
              .select({ savedAmount: financialGoals.savedAmount })
              .from(financialGoals)
              .where(eq(financialGoals.id, id))
              .get()
            if (!current) {
              throw new Error(`Objectif introuvable dans la projection : ${id}`)
            }
            db.update(financialGoals)
              .set({
                savedAmount: round2(
                  current.savedAmount + event.payload.amount,
                ),
                updatedAt: event.occurredAt,
              })
              .where(eq(financialGoals.id, id))
              .run()
            break
          }
        }
      }
    },
  }
}

export type GoalProjector = ReturnType<typeof createGoalProjector>
```

### 5.3 Contexte applicatif

`src/infrastructure/context.ts` :

- `AppContext` gagne `goalProjector: GoalProjector`.
- `createContext` crée `goalProjector: createGoalProjector(db)`.
- Après la séquence `operation`, ajouter :

```ts
const maxGoalId =
  db
    .select({ max: sql<number | null>`max(${financialGoals.id})` })
    .from(financialGoals)
    .get()?.max ?? 0
events.ensureSequence("goal", maxGoalId + 1)
```

- `options.initialize === false` conserve le comportement actuel (pas de séquence).
- Ne pas oublier l'import de `financialGoals`.

### 5.4 Helper d'append

Dans `src/application/commands/append.ts`, ajouter à côté de `appendAndProject` :

```ts
export type AppendGoalOptions = {
  streamId: string
  expectedVersion: number
  events: ReadonlyArray<NewGoalEvent>
}

export function appendGoalAndProject(
  ctx: AppContext,
  options: AppendGoalOptions,
): StoredGoalEvent[] {
  const stored = ctx.events.append(
    options.streamId,
    "goal",
    options.expectedVersion,
    options.events,
  )

  if (stored.length > 0) {
    ctx.goalProjector.apply(stored)
    ctx.events.saveCheckpoint("goals", ctx.events.maxPosition())
  }

  return stored
}
```

Ne **pas** réutiliser `appendAndProject` : il applique le projector des opérations et
écrit le checkpoint `operations`.

### 5.5 Projector des opérations

Dans `createOperationProjector.apply`, ignorer les autres streams avant d'appeler
`operationIdFromStream` :

```ts
for (const event of storedEvents) {
  if (event.streamType !== "operation") continue
  // ...
}
```

Sans ce garde-fou, un événement `GoalCreated` lève
`Flux d’opération invalide : goal:1`.

### 5.6 Replay, verify, rebuild

`scripts/db-utils.ts` — `replayAll` doit dispatcher par type de stream :

```ts
const all = ctx.events.readAll(position, 5000)
if (all.length === 0) break

const operationEvents = all.filter(
  (event): event is StoredEvent<OperationEvent> =>
    event.streamType === "operation",
)
const goalEvents = all.filter(
  (event): event is StoredEvent<GoalEvent> => event.streamType === "goal",
)

if (operationEvents.length > 0) ctx.projector.apply(operationEvents)
if (goalEvents.length > 0) ctx.goalProjector.apply(goalEvents)

position = all[all.length - 1]!.globalPosition
count += all.length
```

Puis `saveCheckpoint("operations", position)` **et** `saveCheckpoint("goals", position)`.

`scripts/verify-projections.ts` :

- supprimer aussi `financial_goals` sur la copie avant replay ;
- comparer les champs `id`, `label`, `targetAmount`, `savedAmount`, `targetMonth`,
  `startMonth`, `status`, `createdAt`, `updatedAt` ;
- afficher le nombre d'objectifs et d'événements rejoués ;
- ne pas comparer `coach_recommendations` (non rejouée, volontairement).

`scripts/rebuild-projections.ts` :

- `ctx.db.delete(financialGoals).run()` avant `replayAll` ;
- **ne pas** supprimer `coach_recommendations` ;
- la FK `coach_recommendations.goal_id` est `onDelete: "set null"`. Pour ne pas vider
  les liens du journal, couper `PRAGMA foreign_keys` **avant** la transaction de
  rebuild (le pragma est sans effet à l'intérieur d'une transaction), puis le
  réactiver après :

  ```ts
  ctx.sqlite.pragma("foreign_keys = OFF")
  const replayed = withTransaction(ctx, () => { ... })
  ctx.sqlite.pragma("foreign_keys = ON")
  ```

  Les ids d'objectifs sont stables (séquence + événements), donc les liens restent
  valides après replay.

---

## 6. Commandes

### 6.1 `createGoal`

`src/application/commands/create-goal.ts` :

```ts
export type CreateGoalInput = {
  label: string
  targetAmount: number
  targetMonth: string
  startMonth: string
  initialSavedAmount?: number
}

export function createGoal(
  ctx: AppContext,
  input: CreateGoalInput,
): { id: number }
```

- Valide via `src/domain/goals/validation.ts`.
- `runCommand(ctx, () => { ... })`.
- `const id = ctx.events.nextId("goal")`.
- `appendGoalAndProject` avec `expectedVersion: 0` et `createMetadata("ui")`.
- Retourne `{ id }`.

### 6.2 `updateGoal`

`src/application/commands/update-goal.ts` :

```ts
export type UpdateGoalInput = {
  id: number
  label?: string
  targetAmount?: number
  targetMonth?: string
  status?: "active" | "paused" | "abandoned"
}

export function updateGoal(ctx: AppContext, input: UpdateGoalInput): GoalState
```

- `loadGoal(ctx, id)` : `foldGoal(ctx.events.readStream<GoalEvent>(goalStreamId(id)))`.
- Si `decideUpdate` renvoie `[]`, ne rien appendre et retourner l'état courant.
- `appendGoalAndProject` avec `expectedVersion: state.version`.
- Retourne le nouvel état (relire le stream ou replier les événements stockés).

### 6.3 `recordGoalContribution`

`src/application/commands/record-goal-contribution.ts` :

```ts
export type RecordGoalContributionInput = {
  id: number
  amount: number // signé
  month: string // YYYY-MM
}

export function recordGoalContribution(
  ctx: AppContext,
  input: RecordGoalContributionInput,
): GoalState
```

- Refuse un objectif introuvable, non `active`, ou un résultat négatif.
- Émet la contribution puis éventuellement `GoalUpdated { status: "achieved" }`.
- Retourne le nouvel état.

### 6.4 `recordRecommendation`

`src/application/commands/record-recommendation.ts` :

```ts
export type RecordRecommendationInput = {
  period: { from: string; to: string }
  goalId: number | null
  kind: CoachRecommendationKind
  payload: CoachRecommendationPayload
}

export function recordRecommendation(
  ctx: AppContext,
  input: RecordRecommendationInput,
): { id: number }
```

- Insert-only dans `coach_recommendations`.
- Aucune transaction événementielle, aucun projector.
- Vérifie que `goalId`, s'il est fourni, existe.
- Le payload est construit par l'appelant (server fn) à partir des indicateurs et des
  objectifs vérifiés ; la commande ne recalcule rien.

### 6.5 `loadGoal`

Créer `src/application/commands/load-goal.ts` (ou helper local) :

```ts
export function loadGoal(ctx: AppContext, id: number): GoalState {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Identifiant d’objectif invalide")
  }
  const state = foldGoal(
    ctx.events.readStream<GoalEvent>(goalStreamId(id)),
  )
  if (!state) throw new Error(`Objectif introuvable : ${id}`)
  return state
}
```

---

## 7. Requêtes et calcul de l'effort

Créer `src/application/queries/goals.ts`.

### 7.1 Types

```ts
export type GoalRealismReason =
  | "achieved"
  | "no-qualified-income"
  | "negative-capacity"
  | "insufficient-history"
  | "effort-above-capacity"
  | "overdue"

export type GoalProgress = {
  id: number
  label: string
  status: GoalStatus
  targetAmount: number
  savedAmount: number
  remaining: number
  progress: number // 0..1
  targetMonth: string
  monthsRemaining: number
  monthlyEffort: number
  observedMonthlyCapacity: number
  alternativeMonthlyEffort: number
  realistic: boolean
  reasons: GoalRealismReason[]
  savedInPeriod: number
  overdue: boolean
}

export type GoalCoachView = Pick<
  GoalProgress,
  | "id"
  | "label"
  | "status"
  | "targetAmount"
  | "savedAmount"
  | "remaining"
  | "targetMonth"
  | "monthsRemaining"
  | "monthlyEffort"
  | "observedMonthlyCapacity"
  | "alternativeMonthlyEffort"
  | "realistic"
  | "reasons"
  | "savedInPeriod"
>
```

### 7.2 Mois

```ts
/** Nombre de mois entiers entre deux `YYYY-MM` (négatif si `to` précède `from`). */
export function monthsBetween(from: string, to: string): number {
  const [fromYear, fromMonth] = from.split("-").map(Number)
  const [toYear, toMonth] = to.split("-").map(Number)
  return (toYear - fromYear) * 12 + (toMonth - fromMonth)
}
```

Tests obligatoires : même mois → 0 ; `2026-12` → `2027-01` → 1 ;
`2026-01` → `2026-12` → 11 ; ordre inverse → négatif.

### 7.3 Progression et effort

```ts
export function computeGoalProgress(
  goal: GoalRecord,
  contributions: ReadonlyArray<{ amount: number; month: string }>,
  input: { asOfMonth: string; period: AnalyticsPeriod; indicators: AnalyticsIndicators },
): GoalProgress
```

`GoalRecord` est la ligne de projection (`typeof financialGoals.$inferSelect`). Les
requêtes lisent la projection ; les commandes, elles, replient les événements pour
obtenir la version et décider.

Formules exactes :

```text
remaining            = max(0, targetAmount - savedAmount)
progress             = targetAmount > 0 ? min(1, savedAmount / targetAmount) : 0
monthsRemaining      = max(0, monthsBetween(asOfMonth, targetMonth))
overdue              = targetMonth < asOfMonth && remaining > 0
monthlyEffort        = remaining === 0
                         ? 0
                         : monthsRemaining > 0
                           ? round2(remaining / monthsRemaining)
                           : remaining          // échéance atteinte, pas de division par 0
capacity             = monthsAvailable > 0
                         ? round2(indicators.savings.observed / monthsAvailable)
                         : 0
qualifiedIncome      = indicators.income.recurring + indicators.income.other
alternativeEffort    = capacity > 0
                         ? round2(min(monthlyEffort, capacity))
                         : 0
savedInPeriod        = somme des contributions dont month ∈ [period.from, period.to]
```

`monthsAvailable` est celui de `dataQuality` : le nombre de mois **réellement couverts
par des opérations**, pas la longueur de la période. Ne pas utiliser
`listMonths(period).length`, sinon un historique partiel gonflerait artificiellement la
capacité.

Raisons (toutes cumulatives) :

| Raison | Condition |
|---|---|
| `achieved` | `status === "achieved"` ou `remaining === 0` |
| `no-qualified-income` | `qualifiedIncome <= 0` |
| `negative-capacity` | `capacity <= 0` |
| `insufficient-history` | `indicators.dataQuality.monthsAvailable < 3` |
| `effort-above-capacity` | `monthlyEffort > capacity` (capacité positive) |
| `overdue` | `overdue === true` |

`realistic = reasons.length === 0` (hors `achieved` : un objectif atteint n'est pas
« irréaliste »). Traiter `achieved` à part :

```ts
const reasons = goal.status === "achieved" || remaining === 0
  ? (["achieved"] as const)
  : [/* autres raisons */]

const realistic =
  !reasons.includes("achieved") && reasons.length === 0
```

`alternativeMonthlyEffort` est toujours `>= 0`, même si la capacité observée est
négative. Ne jamais proposer un effort d'épargne négatif.

### 7.4 Chargement

```ts
export type GoalRecord = typeof financialGoals.$inferSelect

/** Lecture de la projection ; les commandes replient les événements. */
export function loadGoalRecords(ctx: AppContext): GoalRecord[] {
  return ctx.db.select().from(financialGoals).all()
}

export function loadGoalContributions(
  ctx: AppContext,
  goalId: number,
): Array<{ amount: number; month: string }> {
  return ctx.events
    .readStream<GoalEvent>(goalStreamId(goalId))
    .filter(
      (event): event is StoredGoalEvent & {
        type: "GoalContributionRecorded"
      } => event.type === "GoalContributionRecorded",
    )
    .map((event) => event.payload)
}

export function listGoalProgress(
  ctx: AppContext,
  input: { period: AnalyticsPeriod; indicators: AnalyticsIndicators },
): GoalProgress[]
```

- `listGoalProgress` utilise `input.period.to` comme `asOfMonth`.
- Trier : objectifs actifs d'abord, puis `targetMonth` croissant, puis `id`.
- `toGoalCoachView(progress)` retire `progress` (ratio) du payload coach : le modèle
  n'a pas besoin du ratio, et moins de champs = moins d'hallucinations. Le dashboard,
  lui, garde `progress`.

### 7.5 Pas de régression sur les indicateurs

- Ne pas modifier `computeIndicators`, `AnalyticsIndicators` ni `schemaVersion`.
- `savings.observed` reste la seule base de capacité.
- Ne pas utiliser `topExpenses` ni `libelleSimplifie`.

---

## 8. Intégration coach

### 8.1 Contexte

`src/application/queries/coach.ts` :

```ts
export type CoachContext = {
  indicators: AnalyticsIndicators
  goals: GoalCoachView[]
  sources: CoachSource[]
  knowledgeBlock: string
}

export function buildCoachContext(
  ctx: AppContext,
  input: { question: string } & CoachPeriodInput,
): CoachContext {
  const period = resolveCoachPeriod(ctx.db, input)
  const indicators = computeIndicators(loadAnalyticsOperations(ctx.db), period)
  const goals = listGoalProgress(ctx, { period, indicators }).map(
    toGoalCoachView,
  )
  // ... RAG inchangé ...
  return { indicators, goals, sources, knowledgeBlock }
}
```

- `buildCoachContext` charge les objectifs à chaque appel (peu de lignes).
- `getCoachSources` continue de ne retourner que `sources`.
- Ajouter un server fn `getGoalProgress` dans `src/server/goals.ts` (voir § 9) plutôt
  que de changer la forme de `getCoachIndicators`.

### 8.2 Prompt

`src/lib/coach-prompt.ts` :

- Ajouter une règle 10 à `COACH_RULES` :

```text
10. Les objectifs suivis sont fournis dans le bloc `goals`. Tu ne peux pas en créer,
    les modifier ni les valider. Tu peux proposer un effort mensuel chiffré, et tu dois
    refuser un objectif irréaliste en proposant l’alternative chiffrée fournie.
```

- Ajouter `buildGoalPayload(goals: GoalCoachView[]): string` :
  `JSON.stringify(goals, null, 2)`.
- Ajouter `goalDirectives(goals, indicators): string[]` :

| Condition | Directive |
|---|---|
| `goals.length === 0` | « Aucun objectif n’est enregistré : ne prétends pas en connaître un ; propose d’en créer un. » |
| `!realistic && reasons.includes("no-qualified-income")` | « Aucun revenu qualifié : ne fixe pas d’objectif d’épargne ; priorise la qualification des revenus. » |
| `!realistic && reasons.includes("negative-capacity")` | « Capacité d’épargne négative : refuse tout objectif d’épargne et propose de stabiliser le budget. » |
| `!realistic && reasons.includes("effort-above-capacity")` | « L’objectif “<label>” demande X €/mois, au-dessus de la capacité observée Y €/mois : refuse-le et propose Y €/mois (ou l’alternative fournie). » |
| `!realistic && reasons.includes("insufficient-history")` | « Historique trop court : présente l’effort comme une estimation, pas comme une certitude. » |
| `reasons.includes("overdue")` | « L’échéance est passée : signale-le et propose de replanifier, sans culpabiliser. » |
| `reasons.includes("achieved")` | « Objectif atteint : félicite brièvement et propose la suite, sans en inventer une. » |

- `buildCoachSystemPrompt(indicators, goals = [])` insère le bloc objectifs **après**
  le payload des indicateurs et **avant** les fiches de connaissances :

```ts
goals.length > 0
  ? `Objectifs suivis (JSON, source unique de vérité) :\n${buildGoalPayload(goals)}`
  : ""
```

- `buildCoachPayload(indicators)` reste **inchangé** : les tests phase C et la
  compatibilité du payload indicateurs sont préservés.

### 8.3 Endpoint

`src/lib/coach.ts` :

```ts
const { indicators, goals, knowledgeBlock } = buildCoachContext(ctx, { ... })

const stream = chat({
  // ...
  systemPrompts: [
    buildCoachSystemPrompt(indicators, goals),
    knowledgeBlock,
  ].filter((block) => block.length > 0),
})
```

- La période est toujours reconstruite côté serveur.
- Le client ne peut pas injecter un objectif ni un chiffre.
- Ne pas parser la réponse du modèle pour enregistrer une recommandation.

### 8.4 Enregistrement d'une recommandation

`src/server/goals.ts` expose :

```ts
export const recordCoachRecommendation = createServerFn({ method: "POST" })
  .validator(parseRecommendationInput)
  .handler(({ data }) => {
    const ctx = getContext()
    const period = resolveCoachPeriod(ctx.db, data)
    const indicators = computeIndicators(
      loadAnalyticsOperations(ctx.db),
      period,
    )
    const progress = listGoalProgress(ctx, { period, indicators })
    const goal = data.goalId
      ? progress.find((item) => item.id === data.goalId) ?? null
      : null
    const payload = buildRecommendationPayload({
      period,
      indicators,
      progress,
      goal,
    })

    return recordRecommendation(ctx, {
      period,
      goalId: goal?.id ?? null,
      kind: data.kind,
      payload,
    })
  })
```

- Helper pur `buildRecommendationPayload(...)` dans
  `src/application/queries/goals.ts` (ou `src/domain/goals/recommendation.ts`),
  testable sans SQLite.
- Déclenché par un bouton explicite « Enregistrer la recommandation » (pas à chaque
  message du chat, pas en parsant le Markdown).
- `recommendedMonthlyEffort` = `goal.alternativeMonthlyEffort` si un objectif est visé,
  sinon `max(0, capacité mensuelle observée)`.
- `rationale` reprend les `reasons` traduites en français, sans libellé bancaire.
- Un test vérifie qu'un second appel crée une seconde ligne (journal, pas upsert).

---

## 9. Serveur et UI

### 9.1 Server fns

Créer `src/server/goals.ts` :

| Fonction | Méthode | Entrée | Sortie |
|---|---|---|---|
| `getGoalProgress` | GET | `{ from?, to? }` | `GoalProgress[]` |
| `createGoal` | POST | `{ label, targetAmount, targetMonth, startMonth, initialSavedAmount? }` | `{ id }` |
| `updateGoal` | POST | `{ id, label?, targetAmount?, targetMonth?, status? }` | `GoalState` |
| `recordGoalContribution` | POST | `{ id, amount, month }` | `GoalState` |
| `recordCoachRecommendation` | POST | `{ from?, to?, goalId?, kind? }` | `{ id }` |

Règles :

- Validation stricte dans `.validator(...)`, messages en français.
- `getContext()` dans chaque handler ; **jamais** le singleton `db`.
- `getGoalProgress` résout la période avec `resolveCoachPeriod` et calcule les
  indicateurs avec `computeIndicators(loadAnalyticsOperations(ctx.db), period)`.
- Aucune server fn ne retourne de libellé d'opération.

### 9.2 Loader du dashboard

`src/routes/dashboard.tsx` :

```ts
const [summary, indicators, goals] = await Promise.all([
  getBudgetSummary({ data: { ... } }),
  getCoachIndicators({ data: { ... } }),
  getGoalProgress({ data: { from: deps.from ?? null, to: deps.to ?? null } }),
])
return { summary, indicators, goals }
```

### 9.3 Carte « Objectifs »

Créer `src/components/goal-tracking.tsx` (composant client) :

- Props : `goals: GoalProgress[]`, `period: { from: string; to: string }`.
- Utilise `useRouter().invalidate()` après chaque mutation pour recharger le loader.
- Formulaire de création :
  - libellé (texte, 80 max) ;
  - montant cible (number, step 0.01, min 0.01) ;
  - mois cible (`<input type="month">`, min = `period.from`) ;
  - déjà épargné (number, optionnel, défaut 0) ;
  - bouton « Créer l'objectif ».
- Liste des objectifs :
  - libellé + badge de statut ;
  - barre de progression (`progress` en %) ;
  - `savedAmount` / `targetAmount` formatés en EUR (`24,00 € sur 30,00 €`) ;
  - effort mensuel `monthlyEffort` ;
  - si `!realistic` : badge « irréaliste » + `alternativeMonthlyEffort` + raisons
    traduites ;
  - `savedInPeriod` si la période affichée contient des contributions ;
  - formulaire de contribution (montant signé + mois, défaut `period.to`) ;
  - actions pause / reprise / abandon.
- Bouton « Enregistrer la recommandation » par objectif (ou global) → server fn.
- État vide : « Aucun objectif suivi. Créez-en un pour que le coach en tienne compte. »
- Aucun libellé de commerçant, aucune opération listée.

Formatters : extraire `money`, `percent` et `ratio` dans `src/lib/format.ts` et les
réutiliser dans `dashboard.tsx` et `goal-tracking.tsx` (évite trois définitions).

### 9.4 Place dans le dashboard

Insérer `<GoalTracking goals={goals} period={{ from: fromValue, to: toValue }} />`
entre la carte « Indicateurs fiables » et la grille « Catégories / Mois ».
Description : « Objectifs enregistrés côté serveur, repris par le coach à chaque
période. »

Ne pas supprimer la carte « Principales dépenses » dans cette phase (elle reste
purement locale et n'alimente pas le coach).

---

## 10. D.5 — mémoire serveur du transcript (stretch)

**Décision D** : ne pas l'implémenter dans la migration `0009`. La continuité
demandée par le critère d'acceptation est portée par les objectifs, les contributions
et les recommandations, pas par le rejeu des messages bruts.

Si D.5 est tenté après D.4 :

1. Vérifier la compatibilité exacte :

   ```bash
   pnpm exec intent load @tanstack/ai#ai-core/client-persistence
   pnpm view @tanstack/ai-persistence versions
   ```

   Le paquet doit être compatible avec `@tanstack/ai@0.69.0` et
   `@tanstack/ai-react@0.30.4`. Ne pas bumper les paquets TanStack pour autant.

2. Migration `0010` :
   - `coach_threads` : `thread_id` PK, `period_from`, `period_to`, `created_at`,
     `updated_at` ;
   - `coach_messages` : `id` PK autoincrement, `thread_id` FK cascade, `role`,
     `content`, `sequence`, `created_at`, index unique `(thread_id, sequence)`.

3. Route d'hydratation serveur (`hydrateCoachThread`) + `persistence: true` côté
   `useChat`, suppression de `localStoragePersistence`.

4. Tests : rechargement de page, isolation par période, reprise en cours de stream,
   absence de fuite entre périodes.

Tant que D.5 n'est pas fait, le README et le prompt ne doivent pas prétendre que le
transcript est stocké côté serveur.

---

## 11. Tests

Baseline : **119 tests / 13 fichiers**. Objectif : ~50 tests supplémentaires.

### 11.1 Domaine

`src/domain/goals/goal.test.ts` :

- `goalStreamId` / `goalIdFromStream` aller-retour ; stream invalide → erreur.
- `foldGoal` sur `GoalCreated` → `savedAmount`, `status`.
- `GoalUpdated` partiel → seuls les champs modifiés changent.
- `GoalContributionRecorded` positive / négative → `savedAmount` arrondi.
- `decideCreate` refuse cible ≤ 0, mois invalide, `targetMonth < startMonth`.
- `decideUpdate` n'émet rien si le patch est identique.
- `decideUpdate` réouvre un objectif `achieved` si la cible augmente.
- `decideContribution` refuse 0, objectif non actif, résultat négatif.
- `decideContribution` atteint la cible → contribution + `GoalUpdated achieved`.
- `monthsBetween` : même mois, changement d'année, ordre inverse.

### 11.2 Commandes

`src/application/commands/goals.test.ts` (via `createTestContext`) :

- `createGoal` alloue `id = 1`, puis `2` ; la projection contient la ligne.
- `createGoal` avec `initialSavedAmount === targetAmount` → `achieved`.
- `updateGoal` met à jour la projection et `updatedAt`.
- `updateGoal` sans changement n'écrit aucun événement.
- `recordGoalContribution` met à jour `savedAmount` et la projection.
- Contribution qui atteint la cible → statut `achieved`.
- Contribution sur objectif `paused` / `abandoned` → erreur.
- Contribution négative qui rend `savedAmount < 0` → erreur.
- Concurrence : deux mises à jour avec la même version → `ConcurrencyError`.
- `recordRecommendation` insère une ligne ; deux appels → deux lignes.
- Aucun test n'écrit directement dans `financial_goals`.

### 11.3 Projector et event store

`src/infrastructure/projections/goals.test.ts` :

- `GoalCreated` → ligne complète, `createdAt` = `occurredAt`.
- `GoalUpdated` → patch partiel.
- `GoalContributionRecorded` → `savedAmount` recalculé.
- Replay complet depuis les événements → projection identique.
- `createOperationProjector.apply` ignore un événement `goal:*`.

`src/infrastructure/events/event-store.test.ts` :

- `append<GoalEvent>` / `readStream<GoalEvent>` sur `goal:1`.
- Streams mixtes : `readAll()` contient les deux types, `readStream("goal:1")` ne
  contient que les événements d'objectif.
- La version d'un stream d'objectif est indépendante de celle d'une opération.

### 11.4 Requêtes

`src/application/queries/goals.test.ts` — fixture commune :

```text
P1 = 2026-01 → 2026-06 ; P2 = 2026-07 → 2026-12
6 mois × 1 500 € de revenus qualifiés (kind: income, confiance 1)
6 mois × 1 380 € de dépenses essentielles (kind: expense, nature: essential)
=> savings.observed = 720 ; monthsAvailable = 6 ; capacité = 120 €/mois
```

Cas :

1. **Objectif réaliste** : cible 1 440 €, `targetMonth 2027-06`, `asOf 2026-06`
   → `monthsRemaining = 12`, `monthlyEffort = 120`, `realistic = true`.
2. **Objectif irréaliste** : cible 1 000 €, `targetMonth 2026-12`, `asOf 2026-06`
   → `monthlyEffort = 166.67`, `alternativeMonthlyEffort = 120`,
   `realistic = false`, raison `effort-above-capacity`.
3. **Suivi sur deux périodes** : objectif cible 30 € (`targetMonth 2026-12`),
   contribution 24 € en `2026-07` → vue P2 (`asOf 2026-12`) : `savedAmount = 24`,
   `remaining = 6`, `progress = 0.8`, `savedInPeriod = 24`.
   C'est le « 24 € sur 30 € ».
4. **Aucun revenu qualifié** : revenus seulement `unqualified` → raison
   `no-qualified-income`, `alternativeMonthlyEffort = 0`.
5. **Capacité négative** : dépenses > revenus → `negative-capacity`, alternative 0.
6. **Historique court** : 1 mois → `insufficient-history`, `realistic = false`.
7. **Échéance passée** : `targetMonth 2026-05`, `asOf 2026-06` → `overdue = true`,
   `monthsRemaining = 0`, `monthlyEffort = remaining`.
8. **Objectif atteint** : `savedAmount = targetAmount` → raison `achieved`,
   `monthlyEffort = 0`.
9. **Aucun libellé bancaire** : sérialiser `GoalCoachView[]` et vérifier l'absence de
   `libelleSimplifie`, `libelleOperation`, `reference`, `topExpenses`.

### 11.5 Coach

`src/lib/coach.test.ts` (étendre) :

- `buildCoachSystemPrompt(indicators, goals)` contient le bloc `goals`.
- Un objectif irréaliste produit la directive de refus + l'alternative chiffrée.
- `goals = []` produit la directive « aucun objectif enregistré ».
- Les règles 1–9 et les avertissements phase C restent présents.
- `buildCoachPayload(indicators)` est inchangé (compatibilité phase C).

`src/application/queries/coach.test.ts` (étendre) :

- `buildCoachContext` retourne `goals` avec la période demandée.
- Le payload complet ne contient aucun libellé d'opération.
- `getCoachSources` n'est pas impacté.

### 11.6 E2E (optionnel)

`e2e/goals.spec.ts` :

- Créer un objectif via le formulaire, vérifier la carte et le texte de progression.
- Enregistrer une contribution, vérifier `24 € sur 30 €`.
- **Ne pas** exécuter contre `.db/budget.dev.db` : copier la base et lancer avec
  `DATABASE_URL=.db/e2e-goals.db`. Les tests E2E existants ne doivent pas être
  modifiés.

---

## 12. Migration et vérifications

Ordre exact :

```bash
git status --short                  # doit être vide
git log --oneline -3                # c416f06, d9378dc, 6dff04f

pnpm db:backup                      # sauvegarde .db/backups/
# 1. modifier src/db/schema.ts
pnpm db:generate                    # produit drizzle/0009_*.sql + snapshot + journal
pnpm db:migrate                     # applique 0009 sur .db/budget.dev.db

pnpm exec tsc --noEmit
pnpm test:unit
pnpm events:verify                  # 0 différence, objectifs inclus
pnpm build
```

Contrôles supplémentaires :

```bash
pnpm db:generate                    # doit répondre « No schema changes »
pnpm classification:backfill        # inchangé, ne doit rien casser
pnpm knowledge:eval                  # inchangé
```

Mesure de contrôle sur `.db/budget.dev.db` (lecture seule) : recopier le script de la
section « Commandes utiles » du plan parent, puis vérifier :

- `income.recurring + income.other = 3385.05` ;
- `income.total = 33009.24` ;
- `savings.rate = -10.0789` ;
- 3 avertissements ;
- aucun libellé commerçant dans le payload coach.

Pour une démo manuelle des objectifs, **ne pas** écrire dans la base de dev réelle :
copier la base et lancer l'app sur la copie.

```bash
cp .db/budget.dev.db .db/phase-d-demo.db
DATABASE_URL=.db/phase-d-demo.db pnpm dev
```

Puis créer les objectifs via l'UI. Supprimer `.db/phase-d-demo.db` à la fin.

---

## 13. Pièges à ne pas répéter

1. **`replayAll` rejoue tout via le projector des opérations.** Sans dispatch par
   `streamType`, `GoalCreated` lève `Flux d’opération invalide : goal:1`.
2. **`readAll()` change de type.** Mettre à jour
   `ctx.projector.apply(ctx.events.readAll())` dans les tests.
3. **Ne pas réutiliser `appendAndProject`** pour les objectifs : mauvais projector,
   mauvais checkpoint.
4. **Séquence `goal` obligatoire** : sans `ensureSequence("goal", ...)`,
   `ctx.events.nextId("goal")` lève `UnknownStreamError`.
5. **`financial_goals.id` fourni explicitement** : ne jamais laisser SQLite
   l'auto-assigner, sinon la séquence et la projection divergent.
6. **Timestamps déterministes** : `createdAt` / `updatedAt` viennent de
   `event.occurredAt`, pas de `new Date()` dans le projector.
7. **`savedAmount` dérivé** : aucune commande n'écrit `financial_goals` directement.
8. **`coach_recommendations` n'est pas rejouée** : ne pas la supprimer dans
   `events:rebuild`, ne pas la comparer dans `events:verify`.
9. **Pas de `libelleSimplifie` / `topExpenses` / commerçant** dans le payload coach
   ni dans `coach_recommendations`.
10. **`income.total` n'est pas « les revenus »** : revenus qualifiés =
    `income.recurring + income.other`.
11. **Capacité négative** : `alternativeMonthlyEffort = 0`, jamais un effort négatif.
12. **`monthsRemaining = 0`** : ne pas diviser ; l'effort est le reste à payer.
13. **`monthsAvailable < 3`** : marquer `insufficient-history`, ne pas conclure.
14. **`targetMonth < startMonth`** : refuser à la création.
15. **Statut `achieved`** : dérivé d'une contribution, pas saisi à la main.
16. **Migration** : `pnpm db:generate`, jamais d'édition manuelle du snapshot.
17. **`.db/budget.prod.db` interdit** en lecture comme en écriture.
18. **TanStack exact-pinned** : ne pas bumper pour D.5.
19. **E2E** : ne pas muter `.db/budget.dev.db` ; utiliser une copie.
20. **Pas de commit** sans demande explicite.

---

## 14. Definition of Done

- [x] Migration `0009` générée et appliquée sur `.db/budget.dev.db`.
- [x] `financial_goals` + `coach_recommendations` dans `src/db/schema.ts`.
- [x] Enveloppe d'événements partagée ; `OperationEvent` et `GoalEvent` compilent.
- [x] `GoalCreated` / `GoalUpdated` / `GoalContributionRecorded` + `foldGoal` +
      `decide*` + tests.
- [x] `appendGoalAndProject`, `goalProjector`, séquence `goal`, replay dispatch.
- [x] `createGoal`, `updateGoal`, `recordGoalContribution`, `recordRecommendation`.
- [x] `src/application/queries/goals.ts` : `monthsBetween`,
      `computeGoalProgress`, `listGoalProgress`, `toGoalCoachView`.
- [x] `buildCoachContext` expose `goals` ; prompt injecte le bloc + directives ;
      `askCoach` transmet `goals`.
- [x] `src/server/goals.ts` + carte « Objectifs » dans le dashboard.
- [x] Recommandation enregistrée sur action explicite, sans parser le modèle.
- [x] `pnpm exec tsc --noEmit` ✅
- [x] `pnpm test:unit` ✅ (≥ 119 + nouveaux tests)
- [x] `pnpm build` ✅
- [x] `pnpm db:generate` → « No schema changes » ✅
- [x] `pnpm events:verify` → 0 différence, objectifs inclus ✅
- [x] Mesure de contrôle inchangée : 3 385,05 € / -10,0789 / 3 avertissements.
- [x] Aucun libellé commerçant dans le payload coach ni dans les recommandations.
- [x] `.opencode/plans/coach-financier-ia.md` mis à jour (phases D et E faites).
- [x] Arbre de travail prêt ; **pas de commit** sans demande.

---

## 15. Prompt de reprise (à coller dans une session neuve)

> Reprends `.opencode/plans/phase-d-objectifs-suivi.md` et implémente la **phase D
> (objectifs & suivi)** du coach financier. Lis d'abord le plan en entier, puis
> `src/application/queries/coach.ts`, `src/lib/coach-prompt.ts`,
> `src/domain/analytics/types.ts`, `src/db/schema.ts`,
> `src/application/commands/classify-operation.ts`,
> `src/application/commands/append.ts`, `src/infrastructure/context.ts`,
> `src/infrastructure/projections/operations.ts`, `src/infrastructure/events/event-store.ts`
> et `src/routes/dashboard.tsx`.
>
> Contexte : branche `archi-cqrs`, commits `d9378dc` (phase B) et `c416f06` (phase C),
> arbre propre, **119 tests** au départ. Les phases A, B et C sont terminées : ne les
> refais pas. Base `.db/budget.dev.db` uniquement ; `.db/budget.prod.db` est interdit.
> Utilise `getContext()` côté serveur, jamais le singleton `db`. UI et données en
> français, EUR via `Intl.NumberFormat`, TanStack AI/Router exact-pinned.
>
> Implémente D.1 à D.4 : migration `0009` (`financial_goals`,
> `coach_recommendations`), événements `GoalCreated` / `GoalUpdated` /
> `GoalContributionRecorded` + projector, commandes et requêtes d'objectifs,
> injection des objectifs dans `buildCoachContext` puis dans le prompt, carte
> « Objectifs » dans le dashboard, enregistrement explicite des recommandations.
> Laisse D.5 (transcript de chat serveur) en stretch : ne l'implémente pas dans la
> migration `0009` et ne prétends pas que le transcript est serveur.
>
> Contraintes : `savedAmount` dérivé des événements, effort mensuel calculé à la
> lecture, capacité = `savings.observed / dataQuality.monthsAvailable`, alternative
> toujours ≥ 0, aucun `libelleSimplifie` / `topExpenses` / nom de commerçant dans le
> payload coach. Le critère d'acceptation est le scénario de test : « 120 €/mois »
> réaliste, puis « 24 € sur 30 € » sur deux périodes, et refus d'un objectif
> au-dessus de la capacité observée.
>
> Vérifie avec `pnpm exec tsc --noEmit`, `pnpm test:unit` (≥ 119 + nouveaux),
> `pnpm build`, `pnpm db:generate` (« No schema changes »), `pnpm events:verify`
> (0 différence). Termine en mettant à jour la section « Reprise de session » du plan
> parent pour la phase E. **Ne commit pas** sans demande explicite.
