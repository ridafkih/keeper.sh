import type { SourceEvent } from "../types";
import type { SyncRange } from "@keeper.sh/data-schemas";
import type { SyncWindow } from "../sync/sync-range";
import {
  findSourceEventsExceedingRecurrenceBudget,
  RecurrenceMaterializationLimitError,
} from "../events/recurrence-materializer";
import { overlapsTimeWindow } from "../events/time-range";
import {
  buildSourceEventsToAdd,
  buildSourceEventStateIdsToRemove,
} from "../source/event-diff";
import {
  buildInvalidStoredEventIdsToRemove,
  parseStoredSourceEventStatesRecoveringInvalid,
  type StoredSourceEventState,
} from "../source/stored-event-state";

type IngestWideEventFields = Record<string, boolean | number | string>;

/*
 * Identifier lists are a capped sample; an uncapped one would push the line
 * past what the log pipeline keeps and take the counters with it.
 */
const WIDE_EVENT_LIST_LIMIT = 20;
const WIDE_EVENT_LIST_MAX_LENGTH = 2048;

const buildOmittedSuffix = (omittedCount: number): string => {
  if (omittedCount <= 0) {
    return "";
  }
  return ` (+${String(omittedCount)} more)`;
};

const truncateWideEventList = (list: string, omittedCount: number): string => {
  const suffix = buildOmittedSuffix(omittedCount);
  if (list.length <= WIDE_EVENT_LIST_MAX_LENGTH) {
    return `${list}${suffix}`;
  }
  return `${list.slice(0, WIDE_EVENT_LIST_MAX_LENGTH)}... (truncated)${suffix}`;
};

const summarizeWideEventList = (
  values: readonly string[],
  separator = ",",
): string => truncateWideEventList(
  values.slice(0, WIDE_EVENT_LIST_LIMIT).join(separator),
  Math.max(values.length - WIDE_EVENT_LIST_LIMIT, 0),
);

/**
 * Events the provider reported that never reach the diff, so the diff removes
 * their stored state. These counts are the only trace that removal leaves.
 */
interface DiscardedSourceEventCounts {
  outsideSyncWindow: number;
  unrepresentable: number;
}

interface FetchEventsResult {
  events: SourceEvent[];
  discardedEventCounts?: DiscardedSourceEventCounts;
  /**
   * Keeper's own mirrored events, skipped on purpose. Kept out of
   * `discardedEventCounts` so those stay zero on a healthy mirrored calendar.
   */
  selfAuthoredEventCount?: number;
  changedEventIds?: string[];
  snapshot?: CalendarSnapshotChange;
  nextSyncToken?: string;
  cancelledEventIds?: string[];
  isDeltaSync?: boolean;
  fullSyncRequired?: boolean;
  unchanged?: boolean;
  skippedResourceCount?: number;
  skippedResourceReasons?: string[];
  /**
   * Events the provider returned that Keeper cannot represent (an RDATE series,
   * a timezone no runtime can interpret). They stay in `events` so removal stays
   * computed against the full feed; only ingestion withholds them.
   */
  unsupportedEventUids?: string[];
  syncWindow?: SyncWindow;
  coverage?: {
    futureRange: SyncRange;
    historicRange: SyncRange;
    window: SyncWindow;
  };
}

interface IngestionChanges {
  inserts: SourceEvent[];
  deletes: string[];
  snapshot?: CalendarSnapshotChange;
  syncToken?: string | null;
  coverage?: FetchEventsResult["coverage"];
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
  onIngestEvent?: (event: IngestWideEventFields) => void;
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

/*
 * Only delta sources need this. A snapshot source re-reports its whole coverage
 * every fetch, so the snapshot diff already removes whatever it stopped
 * reporting; pruning on top of that would delete the unbounded history an ICS
 * feed still reports. A delta source only reports changes, so a stored event
 * that fell outside a narrowed window would otherwise be stranded forever.
 */
const getNonRecurringStoredEventIdsOutsideWindow = (
  events: (Pick<StoredSourceEventState, "endTime" | "id" | "startTime"> & {
    recurrenceRule: unknown;
  })[],
  window: SyncWindow | undefined,
  isDeltaSync: boolean,
): string[] => {
  if (!window || !isDeltaSync) {
    return [];
  }
  const eventIds: string[] = [];
  for (const event of events) {
    if (!event.recurrenceRule && !overlapsTimeWindow(event, window.timeMin, window.timeMax)) {
      eventIds.push(event.id);
    }
  }
  return eventIds;
};

const ingestSource = async (options: IngestSourceOptions): Promise<IngestionResult> => {
  const { calendarId, fetchEvents, isCurrent, onIngestEvent } = options;

  const wideEvent: IngestWideEventFields = {
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
    if (fetchResult.discardedEventCounts) {
      wideEvent["source_events.discarded_outside_window"] =
        fetchResult.discardedEventCounts.outsideSyncWindow;
      wideEvent["source_events.discarded_unrepresentable"] =
        fetchResult.discardedEventCounts.unrepresentable;
    }
    if (typeof fetchResult.selfAuthoredEventCount === "number") {
      wideEvent["source_events.skipped_self_authored"] = fetchResult.selfAuthoredEventCount;
    }
    if (fetchResult.skippedResourceCount) {
      wideEvent["source_events.skipped_resources"] = fetchResult.skippedResourceCount;
      wideEvent["source_events.skipped_resource_reasons"] =
        summarizeWideEventList(fetchResult.skippedResourceReasons ?? [], "; ");
    }
    let sourceEvents = fetchResult.events;
    const unsupportedEventUids = new Set(fetchResult.unsupportedEventUids);
    if (unsupportedEventUids.size > 0) {
      sourceEvents = sourceEvents.filter(({ uid }) => !unsupportedEventUids.has(uid));
      wideEvent["source_events.unsupported_count"] = unsupportedEventUids.size;
      wideEvent["source_events.unsupported_uids"] =
        summarizeWideEventList([...unsupportedEventUids]);
    }
    if (sourceEvents.some((event) => event.recurrenceRule)) {
      if (!fetchResult.syncWindow) {
        throw new RangeError("Recurring source ingestion requires an explicit sync window");
      }
      const overBudget = findSourceEventsExceedingRecurrenceBudget(
        calendarId,
        sourceEvents,
        {
          end: fetchResult.syncWindow.timeMax,
          start: fetchResult.syncWindow.timeMin,
        },
      );
      if (overBudget.length > 0) {
        /*
         * A widened sync range can pull a pathological series over the occurrence
         * budget. Drop those series and keep ingesting the rest, so one bad series
         * cannot push the whole calendar into permanent ingestion backoff.
         */
        const overBudgetUids = new Set(overBudget.map(({ uid }) => uid));
        sourceEvents = sourceEvents.filter(({ uid }) => !overBudgetUids.has(uid));
        wideEvent["recurrence.over_budget_count"] = overBudget.length;
        wideEvent["recurrence.over_budget_uids"] = summarizeWideEventList([...overBudgetUids]);
      }
    }

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
        wideEvent["stored_events.invalid_ids"] = summarizeWideEventList(invalidStoredEventIds);
        wideEvent["stored_events.validation_errors"] = summarizeWideEventList(
          parseResult.failures.map((failure) => failure.error.message),
          "; ",
        );
      }

      if (isDeltaSync && parseResult.failures.length > 0) {
        await flush({ inserts: [], deletes: [], syncToken: null });
        flushed = true;
        wideEvent["outcome"] = "full-sync-required";
        wideEvent["flushed"] = true;
        return EMPTY_RESULT;
      }

      const eventsToAdd = buildSourceEventsToAdd(existingEvents, sourceEvents, {
        isDeltaSync,
      });
      const invalidStoredEventIdsToRemove = buildInvalidStoredEventIdsToRemove(
        parseResult.failures,
        fetchResult.events,
      );
      const eventStateIdsToRemove = [...new Set([
        ...invalidStoredEventIdsToRemove,
        ...getNonRecurringStoredEventIdsOutsideWindow(
          existingEvents,
          fetchResult.syncWindow,
          isDeltaSync,
        ),
        /*
         * Removal is computed against the unfiltered fetch. An over-budget series is
         * only withheld from ingestion; treating it as absent here would delete the
         * states it already has, turning a stalled series into deleted user events.
         */
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
        if (fetchResult.nextSyncToken || fetchResult.snapshot || fetchResult.coverage) {
          const changes: IngestionChanges = { inserts: [], deletes: [] };
          if (fetchResult.nextSyncToken) {
            changes.syncToken = fetchResult.nextSyncToken;
          }
          if (fetchResult.snapshot) {
            changes.snapshot = fetchResult.snapshot;
          }
          if (fetchResult.coverage) {
            changes.coverage = fetchResult.coverage;
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
      if (fetchResult.coverage) {
        changes.coverage = fetchResult.coverage;
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
      if (error.eventStateId) {
        wideEvent["recurrence.event_state_id"] = error.eventStateId;
      }
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
  DiscardedSourceEventCounts,
  IngestWideEventFields,
  IngestSourceOptions,
  IngestionPersistence,
  IngestionPersistenceWork,
  IngestionResult,
  IngestionChanges,
  FetchEventsResult,
};
