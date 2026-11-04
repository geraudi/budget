import { sql } from "drizzle-orm"
import {
  integer,
  real,
  sqliteTable,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import type { CoachRecommendationPayload } from "../domain/goals/recommendation"

export const categories = sqliteTable(
  "categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    createdAt: text("created_at").notNull().$defaultFn(() =>
      new Date().toISOString(),
    ),
  },
  (t) => [
    uniqueIndex("idx_categories_normalized_name_unique").on(t.normalizedName),
  ],
)

export const subCategories = sqliteTable(
  "sub_categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    createdAt: text("created_at").notNull().$defaultFn(() =>
      new Date().toISOString(),
    ),
  },
  (t) => [
    uniqueIndex("idx_sub_categories_category_name_unique").on(
      t.categoryId,
      t.normalizedName,
    ),
    index("idx_sub_categories_category").on(t.categoryId),
  ],
)

export const operations = sqliteTable(
  "operations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dateComptabilisation: text("date_comptabilisation").notNull(),
    libelleSimplifie: text("libelle_simplifie").notNull(),
    libelleOperation: text("libelle_operation").notNull(),
    reference: text("reference"),
    infosComplementaires: text("infos_complementaires"),
    typeOperation: text("type_operation"),
    categoryId: integer("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    subCategoryId: integer("sub_category_id").references(
      () => subCategories.id,
      { onDelete: "set null" },
    ),
    /**
     * Classification derived from `category_classification_rules` by the
     * projector, or overridden by an `OperationClassified` event.
     * `null` means the operation has not been classified yet.
     */
    kind: text("kind", {
      enum: [
        "income",
        "expense",
        "transfer",
        "savings",
        "debt_payment",
        "refund",
        "excluded",
      ],
    }),
    nature: text("nature", {
      enum: ["essential", "discretionary", "exceptional"],
    }),
    classificationSource: text("classification_source", {
      enum: ["rule", "manual", "import"],
    }),
    classificationConfidence: real("classification_confidence"),
    debit: real("debit"),
    credit: real("credit"),
    montant: real("montant").notNull(),
    dateOperation: text("date_operation"),
    dateValeur: text("date_valeur"),
    pointage: integer("pointage"),
    isRecurring: integer("is_recurring", { mode: "boolean" })
      .notNull()
      .default(false),
    fingerprint: text("fingerprint"),
  },
  (t) => [
    index("idx_ops_libelle").on(t.libelleSimplifie),
    index("idx_ops_date").on(t.dateComptabilisation),
    index("idx_ops_category_id").on(t.categoryId),
    index("idx_ops_sub_category_id").on(t.subCategoryId),
    index("idx_ops_recurring").on(t.isRecurring),
    index("idx_ops_fingerprint").on(t.fingerprint),
    index("idx_ops_kind").on(t.kind),
  ],
)

/**
 * Default `kind` / `nature` for a category or a sub-category.
 *
 * A sub-category rule wins over its category rule. Rules only produce
 * derived defaults: a manual `OperationClassified` override always wins.
 */
export const categoryClassificationRules = sqliteTable(
  "category_classification_rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    subCategoryId: integer("sub_category_id").references(
      () => subCategories.id,
      { onDelete: "cascade" },
    ),
    kind: text("kind", {
      enum: [
        "income",
        "expense",
        "transfer",
        "savings",
        "debt_payment",
        "refund",
        "excluded",
      ],
    }).notNull(),
    nature: text("nature", {
      enum: ["essential", "discretionary", "exceptional"],
    }),
    confidence: real("confidence").notNull().default(1),
    createdAt: text("created_at").notNull().$defaultFn(() =>
      new Date().toISOString(),
    ),
  },
  (t) => [
    // One rule per sub-category, one fallback rule per category.
    uniqueIndex("idx_classification_rules_sub_unique")
      .on(t.subCategoryId)
      .where(sql`${t.subCategoryId} is not null`),
    uniqueIndex("idx_classification_rules_category_unique")
      .on(t.categoryId)
      .where(sql`${t.subCategoryId} is null`),
    index("idx_classification_rules_category").on(t.categoryId),
  ],
)

export const recurringLabels = sqliteTable(
  "recurring_labels",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    pattern: text("pattern").notNull().unique(),
    createdAt: text("created_at").notNull().$defaultFn(() =>
      new Date().toISOString(),
    ),
  },
)

export const recurringOperations = sqliteTable(
  "recurring_operations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    libelleSimplifie: text("libelle_simplifie").notNull(),
    montant: real("montant").notNull(),
    intervalMonths: integer("interval_months").notNull().default(1),
    firstMonth: text("first_month").notNull(),
    durationType: text("duration_type", {
      enum: ["unlimited", "until", "count"],
    })
      .notNull()
      .default("unlimited"),
    endMonth: text("end_month"),
    occurrences: integer("occurrences"),
    matchMode: text("match_mode", {
      enum: ["exact", "contains", "regex"],
    })
      .notNull()
      .default("exact"),
    matchPattern: text("match_pattern"),
    createdAt: text("created_at").notNull().$defaultFn(() =>
      new Date().toISOString(),
    ),
  },
  (t) => [
    uniqueIndex("idx_recurring_ops_libelle_unique").on(t.libelleSimplifie),
    index("idx_recurring_ops_first_month").on(t.firstMonth),
  ],
)

/**
 * Append-only event log. The `operations` table is a projection of these
 * events; `streams` tracks the current version of each aggregate stream.
 */
export const events = sqliteTable(
  "events",
  {
    globalPosition: integer("global_position").primaryKey({
      autoIncrement: true,
    }),
    eventId: text("event_id").notNull().unique(),
    streamId: text("stream_id").notNull(),
    streamType: text("stream_type").notNull(),
    streamVersion: integer("stream_version").notNull(),
    eventType: text("event_type").notNull(),
    payload: text("payload", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    metadata: text("metadata", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    occurredAt: text("occurred_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_events_stream_version_unique").on(
      t.streamId,
      t.streamVersion,
    ),
    index("idx_events_stream").on(t.streamId),
    index("idx_events_type").on(t.eventType),
  ],
)

export const streams = sqliteTable("streams", {
  streamId: text("stream_id").primaryKey(),
  streamType: text("stream_type").notNull(),
  currentVersion: integer("current_version").notNull().default(0),
})

export const sequences = sqliteTable("sequences", {
  name: text("name").primaryKey(),
  nextValue: integer("next_value").notNull(),
})

export const projectionCheckpoints = sqliteTable(
  "projection_checkpoints",
  {
    name: text("name").primaryKey(),
    position: integer("position").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
)

/**
 * Goal read model, projected from the `goal:<id>` event streams.
 *
 * `id` is always supplied by the `goal` sequence. `savedAmount` is derived
 * from `GoalContributionRecorded` events and is never written by a command.
 * The monthly effort and the progress ratio are computed at read time.
 */
export const financialGoals = sqliteTable(
  "financial_goals",
  {
    id: integer("id").primaryKey(),
    label: text("label").notNull(),
    targetAmount: real("target_amount").notNull(),
    savedAmount: real("saved_amount").notNull().default(0),
    targetMonth: text("target_month").notNull(),
    startMonth: text("start_month").notNull(),
    status: text("status", {
      enum: ["active", "paused", "achieved", "abandoned"],
    })
      .notNull()
      .default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_goals_status").on(t.status),
    index("idx_goals_target_month").on(t.targetMonth),
  ],
)

/**
 * Append-only journal of saved recommendations.
 *
 * It is not an event-sourced aggregate: `events:rebuild` never deletes or
 * replays it. `goal_id` is nullable so deleting a goal never removes history.
 */
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
