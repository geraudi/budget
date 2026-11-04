/**
 * A knowledge card is a short, original summary of a French personal-finance
 * topic, with its source and its limits. Cards are the retrieval unit of the
 * coach: one card = one Markdown file in `src/content/knowledge`.
 */
export type KnowledgeCategory =
  | 'budget_management'
  | 'expense_reduction'
  | 'savings'
  | 'debt'
  | 'goals'
  | 'financial_education'
  | 'financial_difficulty'

export const KNOWLEDGE_CATEGORIES: readonly KnowledgeCategory[] = [
  'budget_management',
  'expense_reduction',
  'savings',
  'debt',
  'goals',
  'financial_education',
  'financial_difficulty',
]

export const KNOWLEDGE_CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  budget_management: 'Gestion du budget',
  expense_reduction: 'Réduction des dépenses',
  savings: 'Épargne',
  debt: 'Dettes',
  goals: 'Objectifs',
  financial_education: 'Éducation financière',
  financial_difficulty: 'Difficultés financières',
}

export type KnowledgeEntry = {
  id: string
  title: string
  category: KnowledgeCategory
  source: string
  sourceUrl: string | null
  /** Date at which the source was read and the summary written (ISO date). */
  consultedAt: string
  /** Last update date of the source, when it publishes one. */
  updatedAt: string | null
  /** The card must be reviewed before being cited as current. */
  reviewRequired: boolean
  tags: string[]
  limitations: string[]
  /** Markdown body, without the front-matter. */
  body: string
}

export type KnowledgeMatch = {
  entry: KnowledgeEntry
  score: number
  matchedTerms: string[]
}

export type KnowledgeRetrievalStrategy = 'lexical' | 'embedding' | 'hybrid'

/**
 * Engine used by the application when no strategy is specified. Hybrid won the
 * 50-question evaluation on recall@1, recall@3 and MRR; lexical remains the
 * offline fallback when vectors or the embedding server are unavailable.
 */
export const DEFAULT_KNOWLEDGE_RETRIEVAL: KnowledgeRetrievalStrategy = 'hybrid'
