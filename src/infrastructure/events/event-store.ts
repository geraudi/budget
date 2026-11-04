import { asc, eq, gt, sql } from 'drizzle-orm'

import type { AppDb } from '#/db/create'
import {
  events,
  projectionCheckpoints,
  sequences,
  streams,
} from '#/db/schema'
import type { AnyEvent } from '#/domain/events'
import type {
  EventMetadata,
  NewEvent,
  StoredEvent,
} from '#/domain/events/envelope'
import type { OperationEvent } from '#/domain/operations/events'

export class ConcurrencyError extends Error {
  constructor(streamId: string, expected: number, actual: number) {
    super(
      `Conflit de version sur ${streamId} : attendu ${expected}, actuel ${actual}`,
    )
    this.name = 'ConcurrencyError'
  }
}

export class UnknownStreamError extends Error {
  constructor(streamId: string) {
    super(`Flux inconnu : ${streamId}`)
    this.name = 'UnknownStreamError'
  }
}

function toStoredEvent<TEvent extends AnyEvent>(
  row: typeof events.$inferSelect,
): StoredEvent<TEvent> {
  return {
    type: row.eventType as TEvent['type'],
    payload: row.payload,
    metadata: row.metadata as EventMetadata,
    globalPosition: row.globalPosition,
    eventId: row.eventId,
    streamId: row.streamId,
    streamType: row.streamType,
    streamVersion: row.streamVersion,
    occurredAt: row.occurredAt,
  } as unknown as StoredEvent<TEvent>
}

export function createEventStore(db: AppDb) {
  return {
    hasStream(streamId: string): boolean {
      return Boolean(
        db.select().from(streams).where(eq(streams.streamId, streamId)).get(),
      )
    },

    streamVersion(streamId: string): number | null {
      const stream = db
        .select({ version: streams.currentVersion })
        .from(streams)
        .where(eq(streams.streamId, streamId))
        .get()
      return stream?.version ?? null
    },

    /**
     * Appends events to a stream with optimistic concurrency.
     *
     * The caller is responsible for wrapping this in a transaction together
     * with the projection update (see `appendAndProject`).
     */
    append<TEvent extends AnyEvent = OperationEvent>(
      streamId: string,
      streamType: string,
      expectedVersion: number,
      newEvents: ReadonlyArray<NewEvent<TEvent>>,
    ): StoredEvent<TEvent>[] {
      if (newEvents.length === 0) return []

      const existing = db
        .select({ version: streams.currentVersion })
        .from(streams)
        .where(eq(streams.streamId, streamId))
        .get()

      if (!existing) {
        if (expectedVersion !== 0) {
          throw new ConcurrencyError(streamId, expectedVersion, 0)
        }
        db.insert(streams)
          .values({ streamId, streamType, currentVersion: 0 })
          .run()
      } else if (existing.version !== expectedVersion) {
        throw new ConcurrencyError(streamId, expectedVersion, existing.version)
      }

      const now = new Date().toISOString()
      const rows = db
        .insert(events)
        .values(
          newEvents.map((event, index) => ({
            eventId: event.eventId ?? crypto.randomUUID(),
            streamId,
            streamType,
            streamVersion: expectedVersion + index + 1,
            eventType: event.type,
            payload: event.payload,
            metadata: event.metadata,
            occurredAt: event.occurredAt ?? now,
          })),
        )
        .returning()
        .all()

      db.update(streams)
        .set({ currentVersion: expectedVersion + newEvents.length })
        .where(eq(streams.streamId, streamId))
        .run()

      return rows.map((row) => toStoredEvent<TEvent>(row))
    },

    readStream<TEvent extends AnyEvent = OperationEvent>(
      streamId: string,
    ): StoredEvent<TEvent>[] {
      return db
        .select()
        .from(events)
        .where(eq(events.streamId, streamId))
        .orderBy(asc(events.streamVersion))
        .all()
        .map((row) => toStoredEvent<TEvent>(row))
    },

    readAll<TEvent extends AnyEvent = AnyEvent>(
      fromPosition = 0,
      limit = 10_000,
    ): StoredEvent<TEvent>[] {
      return db
        .select()
        .from(events)
        .where(gt(events.globalPosition, fromPosition))
        .orderBy(asc(events.globalPosition))
        .limit(limit)
        .all()
        .map((row) => toStoredEvent<TEvent>(row))
    },

    maxPosition(): number {
      const row = db
        .select({ max: sql<number | null>`max(${events.globalPosition})` })
        .from(events)
        .get()
      return row?.max ?? 0
    },

    nextId(name: string): number {
      const row = db
        .select({ nextValue: sequences.nextValue })
        .from(sequences)
        .where(eq(sequences.name, name))
        .get()
      if (!row) throw new UnknownStreamError(`séquence ${name}`)

      db.update(sequences)
        .set({ nextValue: row.nextValue + 1 })
        .where(eq(sequences.name, name))
        .run()

      return row.nextValue
    },

    ensureSequence(name: string, nextValue: number): void {
      const row = db
        .select({ nextValue: sequences.nextValue })
        .from(sequences)
        .where(eq(sequences.name, name))
        .get()

      if (!row) {
        db.insert(sequences).values({ name, nextValue }).run()
        return
      }

      if (row.nextValue < nextValue) {
        db.update(sequences)
          .set({ nextValue })
          .where(eq(sequences.name, name))
          .run()
      }
    },

    saveCheckpoint(name: string, position: number): void {
      const updatedAt = new Date().toISOString()
      db.insert(projectionCheckpoints)
        .values({ name, position, updatedAt })
        .onConflictDoUpdate({
          target: projectionCheckpoints.name,
          set: { position, updatedAt },
        })
        .run()
    },

    getCheckpoint(name: string): number | null {
      return (
        db
          .select({ position: projectionCheckpoints.position })
          .from(projectionCheckpoints)
          .where(eq(projectionCheckpoints.name, name))
          .get()?.position ?? null
      )
    },
  }
}

export type EventStore = ReturnType<typeof createEventStore>
