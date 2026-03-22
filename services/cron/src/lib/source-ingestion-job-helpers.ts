import {
  ingestSource,
  insertEventStatesWithConflictResolution,
} from "@keeper.sh/calendar";
import type { IngestionChanges, IngestionFetchEventsResult } from "@keeper.sh/calendar";
import { calendarAccountsTable, calendarsTable, eventStatesTable } from "@keeper.sh/database/schema";
import {
  RedisCommandOutboxStore,
  createMachineRuntimeWidelogSink,
  createSequencedRuntimeEnvelopeFactory,
  createSourceIngestionLifecycleRuntime,
  type SourceIngestionLogger,
} from "@keeper.sh/machine-orchestration";
import type { SourceIngestionLifecycleRuntime } from "@keeper.sh/machine-orchestration";
import { and, eq, inArray } from "drizzle-orm";
import { database, refreshLockRedis } from "@/context";
import { context, widelog } from "@/utils/logging";
import { SourceIngestionTimeoutError } from "./source-ingestion-errors";

const SOURCE_TIMEOUT_MS = 60_000;
const SOURCE_CONCURRENCY = 5;

interface IngestionSourceResult {
  eventsAdded: number;
  eventsRemoved: number;
  ingestEvents: Record<string, unknown>[];
}

interface SourceIngestionBatchResult extends IngestionSourceResult {
  errors: number;
}

interface SourceIngestionMetadata {
  accountId?: string;
  calendarId: string;
  externalCalendarId?: string | null;
  provider: string;
  userId: string;
}

interface SourceRuntimeHandlers {
  disableSource: () => Promise<void>;
  markNeedsReauth: () => Promise<void>;
  persistSyncToken: (syncToken: string) => Promise<void>;
}

const emptySourceIngestionBatchResult = (): SourceIngestionBatchResult => ({
  added: 0,
  errors: 0,
  eventsAdded: 0,
  eventsRemoved: 0,
  ingestEvents: [],
  removed: 0,
});

const serializeOptionalJson = (value: unknown): string | null => {
  if (!value) {
    return null;
  }
  return JSON.stringify(value);
};

const withTimeout = <TResult>(
  operation: () => Promise<TResult>,
  timeoutMs = SOURCE_TIMEOUT_MS,
): Promise<TResult> =>
  Promise.race([
    Promise.resolve().then(operation),
    Bun.sleep(timeoutMs).then((): never => {
      throw new SourceIngestionTimeoutError(timeoutMs);
    }),
  ]);

const createIngestionFlush = (calendarId: string) =>
  async (changes: IngestionChanges): Promise<void> => {
    await database.transaction(async (transaction) => {
      if (changes.deletes.length > 0) {
        await transaction
          .delete(eventStatesTable)
          .where(
            and(
              eq(eventStatesTable.calendarId, calendarId),
              inArray(eventStatesTable.id, changes.deletes),
            ),
          );
      }

      if (changes.inserts.length > 0) {
        await insertEventStatesWithConflictResolution(
          transaction,
          changes.inserts.map((event) => ({
            availability: event.availability,
            calendarId,
            description: event.description,
            endTime: event.endTime,
            exceptionDates: serializeOptionalJson(event.exceptionDates),
            isAllDay: event.isAllDay,
            location: event.location,
            recurrenceRule: serializeOptionalJson(event.recurrenceRule),
            sourceEventType: event.sourceEventType,
            sourceEventUid: event.uid,
            startTime: event.startTime,
            startTimeZone: event.startTimeZone,
            title: event.title,
          })),
        );
      }

      if ("syncToken" in changes) {
        await transaction
          .update(calendarsTable)
          .set({ syncToken: changes.syncToken })
          .where(eq(calendarsTable.id, calendarId));
      }
    });
  };

const readExistingEvents = (calendarId: string) =>
  database
    .select({
      availability: eventStatesTable.availability,
      endTime: eventStatesTable.endTime,
      id: eventStatesTable.id,
      isAllDay: eventStatesTable.isAllDay,
      sourceEventType: eventStatesTable.sourceEventType,
      sourceEventUid: eventStatesTable.sourceEventUid,
      startTime: eventStatesTable.startTime,
    })
    .from(eventStatesTable)
    .where(eq(eventStatesTable.calendarId, calendarId));

const disableCalendarById = async (calendarId: string): Promise<void> => {
  await database
    .update(calendarsTable)
    .set({ disabled: true })
    .where(eq(calendarsTable.id, calendarId));
};

const markCalendarAccountNeedsReauthById = async (accountId: string): Promise<void> => {
  await database
    .update(calendarAccountsTable)
    .set({ needsReauthentication: true })
    .where(eq(calendarAccountsTable.id, accountId));
};

const persistCalendarSyncTokenById = async (calendarId: string, syncToken: string): Promise<void> => {
  await database
    .update(calendarsTable)
    .set({ syncToken })
    .where(eq(calendarsTable.id, calendarId));
};

const createSourceRuntime = (input: {
  metadata: SourceIngestionMetadata;
  handlers: SourceRuntimeHandlers;
}): SourceIngestionLifecycleRuntime => {
  const createEnvelope = createSequencedRuntimeEnvelopeFactory({
    actor: { id: "cron-ingest", type: "system" },
    aggregateId: input.metadata.calendarId,
    now: () => new Date().toISOString(),
  });
  return createSourceIngestionLifecycleRuntime({
    createEnvelope,
    handlers: input.handlers,
    outboxStore: new RedisCommandOutboxStore({
      keyPrefix: "machine:outbox:source-ingestion-lifecycle",
      redis: refreshLockRedis,
    }),
    onRuntimeEvent: createMachineRuntimeWidelogSink(
      "source_ingestion_lifecycle",
      (field, value) => {
        widelog.set(field, value);
      },
    ),
    provider: input.metadata.provider,
    sourceId: input.metadata.calendarId,
  });
};

const createSourceIngestionLogger = (): SourceIngestionLogger => ({
  errorFields: (error, fields) => {
    widelog.errorFields(error, fields);
  },
  flush: () => {
    widelog.flush();
  },
  measureDuration: <TResult>(operation: () => Promise<TResult>) =>
    widelog.time.measure("duration_ms", operation),
  set: (field, value) => {
    widelog.set(field, value as Parameters<typeof widelog.set>[1]);
  },
});

const ingestWithFetcher = async (input: {
  calendarId: string;
  provider: string;
  fetchEvents: () => Promise<IngestionFetchEventsResult>;
}): Promise<IngestionSourceResult> => {
  const ingestEvents: Record<string, unknown>[] = [];
  const ingestResult = await ingestSource({
    calendarId: input.calendarId,
    fetchEvents: input.fetchEvents,
    flush: createIngestionFlush(input.calendarId),
    onIngestEvent: (event) => {
      ingestEvents.push({
        ...event,
        "source.provider": input.provider,
      });
    },
    readExistingEvents: () => readExistingEvents(input.calendarId),
  });

  return {
    eventsAdded: ingestResult.eventsAdded,
    eventsRemoved: ingestResult.eventsRemoved,
    ingestEvents,
  };
};

const runIngestionContext = <TResult>(operation: () => Promise<TResult>): Promise<TResult> =>
  context(operation);

export {
  SOURCE_CONCURRENCY,
  SOURCE_TIMEOUT_MS,
  createSourceIngestionLogger,
  createSourceRuntime,
  disableCalendarById,
  emptySourceIngestionBatchResult,
  ingestWithFetcher,
  markCalendarAccountNeedsReauthById,
  persistCalendarSyncTokenById,
  readExistingEvents,
  runIngestionContext,
  withTimeout,
};
export type {
  IngestionSourceResult,
  SourceIngestionBatchResult,
  SourceIngestionMetadata,
};
