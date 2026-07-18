import type { SourceEvent } from "../types";
import { getOAuthSyncWindow } from "../oauth/sync-window";
import {
  assertSourceRecurrenceMaterializationWithinBudget,
  RecurrenceMaterializationLimitError,
} from "../events/recurrence-materializer";
import {
  buildSourceEventsToAdd,
  buildSourceEventStateIdsToRemove,
} from "../source/event-diff";
import {
  buildInvalidStoredEventIdsToRemove,
  parseStoredSourceEventStatesRecoveringInvalid,
  type StoredSourceEventState,
} from "../source/stored-event-state";

interface FetchEventsResult {
  events: SourceEvent[];
  changedEventIds?: string[];
  snapshot?: CalendarSnapshotChange;
  nextSyncToken?: string;
  cancelledEventIds?: string[];
  isDeltaSync?: boolean;
  fullSyncRequired?: boolean;
  unchanged?: boolean;
}

interface IngestionChanges {
  inserts: SourceEvent[];
  deletes: string[];
  snapshot?: CalendarSnapshotChange;
  syncToken?: string | null;
}

interface CalendarSnapshotChange {
  contentHash: string;
  ical: string;
}

interface IngestionPersistence {
  readExistingEvents: () => Promise<StoredSourceEventState[]>;
  flush: (changes: IngestionChanges) => Promise<void>;
}

type IngestionPersistenceWork = (
  persistence: IngestionPersistence,
) => Promise<IngestionResult>;

interface BaseIngestSourceOptions {
  calendarId: string;
  fetchEvents: () => Promise<FetchEventsResult>;
  isCurrent?: () => Promise<boolean>;
  onIngestEvent?: (event: Record<string, unknown>) => void;
}

interface DirectIngestSourceOptions extends BaseIngestSourceOptions {
  readExistingEvents: () => Promise<StoredSourceEventState[]>;
  flush: (changes: IngestionChanges) => Promise<void>;
  withPersistenceTransaction?: never;
}

interface TransactionalIngestSourceOptions extends BaseIngestSourceOptions {
  withPersistenceTransaction: (
    work: IngestionPersistenceWork,
  ) => Promise<IngestionResult>;
}

type IngestSourceOptions = DirectIngestSourceOptions | TransactionalIngestSourceOptions;

const resolvePersistenceTransaction = (
  options: IngestSourceOptions,
): TransactionalIngestSourceOptions["withPersistenceTransaction"] => {
  if ("readExistingEvents" in options) {
    const { flush, readExistingEvents } = options;
    return (work: IngestionPersistenceWork) => work({ flush, readExistingEvents });
  }
  const { withPersistenceTransaction } = options;
  return withPersistenceTransaction;
};

interface IngestionResult {
  eventsAdded: number;
  eventsRemoved: number;
}

const EMPTY_RESULT: IngestionResult = { eventsAdded: 0, eventsRemoved: 0 };
const RECURRENCE_VALIDATION_YEARS = 2;

const ingestSource = async (options: IngestSourceOptions): Promise<IngestionResult> => {
  const { calendarId, fetchEvents, isCurrent, onIngestEvent } = options;

  const wideEvent: Record<string, unknown> = {
    "calendar.id": calendarId,
    "operation.name": "ingest:source",
    "operation.type": "ingest",
  };

  const startTime = Date.now();
  let flushed = false;

  try {
    const withPersistenceTransaction = resolvePersistenceTransaction(options);
    const fetchResult = await fetchEvents();
    wideEvent["source_events.count"] = fetchResult.events.length;
    const recurrenceValidationWindow = getOAuthSyncWindow(RECURRENCE_VALIDATION_YEARS);

    assertSourceRecurrenceMaterializationWithinBudget(
      calendarId,
      fetchResult.events,
      {
        end: recurrenceValidationWindow.timeMax,
        start: recurrenceValidationWindow.timeMin,
      },
    );

    if (isCurrent && !(await isCurrent())) {
      wideEvent["outcome"] = "superseded";
      wideEvent["flushed"] = false;
      return EMPTY_RESULT;
    }

    return await withPersistenceTransaction(async ({ readExistingEvents, flush }) => {
      if (fetchResult.unchanged) {
        wideEvent["outcome"] = "unchanged";
        wideEvent["flushed"] = false;
        return EMPTY_RESULT;
      }

      if (fetchResult.fullSyncRequired) {
        wideEvent["outcome"] = "full-sync-required";
        wideEvent["flushed"] = true;
        await flush({ inserts: [], deletes: [], syncToken: null });
        flushed = true;
        return EMPTY_RESULT;
      }

      const storedEvents = await readExistingEvents();
      wideEvent["existing_events.count"] = storedEvents.length;

      const isDeltaSync = fetchResult.isDeltaSync ?? false;
      const parseResult = parseStoredSourceEventStatesRecoveringInvalid(storedEvents);
      const existingEvents = parseResult.events;
      const invalidStoredEventIds = parseResult.failures.map((failure) => failure.eventId);
      if (parseResult.failures.length > 0) {
        wideEvent["stored_events.invalid_count"] = parseResult.failures.length;
        wideEvent["stored_events.invalid_ids"] = invalidStoredEventIds;
        wideEvent["stored_events.validation_errors"] = parseResult.failures.map(
          (failure) => failure.error.message,
        );
      }

      if (isDeltaSync && parseResult.failures.length > 0) {
        await flush({ inserts: [], deletes: [], syncToken: null });
        flushed = true;
        wideEvent["outcome"] = "full-sync-required";
        wideEvent["flushed"] = true;
        return EMPTY_RESULT;
      }

      const eventsToAdd = buildSourceEventsToAdd(existingEvents, fetchResult.events, {
        isDeltaSync,
      });
      const invalidStoredEventIdsToRemove = buildInvalidStoredEventIdsToRemove(
        parseResult.failures,
        fetchResult.events,
      );
      const eventStateIdsToRemove = [...new Set([
        ...invalidStoredEventIdsToRemove,
        ...buildSourceEventStateIdsToRemove(
          existingEvents,
          fetchResult.events,
          {
            changedEventIds: fetchResult.changedEventIds,
            cancelledEventIds: fetchResult.cancelledEventIds,
            isDeltaSync,
          },
        ),
      ])];

      wideEvent["events.added"] = eventsToAdd.length;
      wideEvent["events.removed"] = eventStateIdsToRemove.length;

      if (eventsToAdd.length === 0 && eventStateIdsToRemove.length === 0) {
        if (fetchResult.nextSyncToken || fetchResult.snapshot) {
          const changes: IngestionChanges = { inserts: [], deletes: [] };
          if (fetchResult.nextSyncToken) {
            changes.syncToken = fetchResult.nextSyncToken;
          }
          if (fetchResult.snapshot) {
            changes.snapshot = fetchResult.snapshot;
          }
          await flush(changes);
          flushed = true;
          wideEvent["outcome"] = "in-sync";
          wideEvent["flushed"] = true;
          return EMPTY_RESULT;
        }

        wideEvent["outcome"] = "in-sync";
        wideEvent["flushed"] = false;
        return EMPTY_RESULT;
      }

      const changes: IngestionChanges = {
        inserts: eventsToAdd,
        deletes: eventStateIdsToRemove,
      };

      if (typeof fetchResult.nextSyncToken === "string") {
        changes.syncToken = fetchResult.nextSyncToken;
      }
      if (fetchResult.snapshot) {
        changes.snapshot = fetchResult.snapshot;
      }

      await flush(changes);

      flushed = true;
      wideEvent["outcome"] = "success";
      wideEvent["flushed"] = true;

      return {
        eventsAdded: eventsToAdd.length,
        eventsRemoved: eventStateIdsToRemove.length,
      };
    });
  } catch (error) {
    wideEvent["outcome"] = "error";
    wideEvent["flushed"] = flushed;

    if (error instanceof Error) {
      wideEvent["error.message"] = error.message;
      wideEvent["error.type"] = error.constructor.name;
    }
    if (error instanceof RecurrenceMaterializationLimitError) {
      wideEvent["recurrence.calendar_id"] = error.calendarId;
      wideEvent["recurrence.event_id"] = error.eventId;
      wideEvent["recurrence.event_state_id"] = error.eventStateId;
      wideEvent["recurrence.limit"] = error.limit;
      wideEvent["recurrence.source_event_uid"] = error.sourceEventUid;
    }

    throw error;
  } finally {
    wideEvent["duration_ms"] = Date.now() - startTime;
    onIngestEvent?.(wideEvent);
  }
};

export { ingestSource };
export type {
  CalendarSnapshotChange,
  IngestSourceOptions,
  IngestionPersistence,
  IngestionPersistenceWork,
  IngestionResult,
  IngestionChanges,
  FetchEventsResult,
};
