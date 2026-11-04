/**
 * Shared event envelope for every aggregate.
 *
 * Payloads stay domain-specific; only the transport metadata and the stored
 * shape are shared so the event store can append both operation and goal
 * streams without duplicating logic.
 */

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
