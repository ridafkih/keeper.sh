import type { SourceEvent } from "../types";
import { buildSourceEventsToAdd, buildSourceEventStateIdsToRemove } from "../source/event-diff";
import {
  parseStoredSourceEventStates,
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

interface IngestSourceOptions {
  calendarId: string;
  fetchEvents: () => Promise<FetchEventsResult>;
  readExistingEvents: () => Promise<StoredSourceEventState[]>;
  flush: (changes: IngestionChanges) => Promise<void>;
  onIngestEvent?: (event: Record<string, unknown>) => void;
}

interface IngestionResult {
  eventsAdded: number;
  eventsRemoved: number;
}

const EMPTY_RESULT: IngestionResult = { eventsAdded: 0, eventsRemoved: 0 };

const ingestSource = async (options: IngestSourceOptions): Promise<IngestionResult> => {
  const { calendarId, fetchEvents, readExistingEvents, flush, onIngestEvent } = options;

  const wideEvent: Record<string, unknown> = {
    "calendar.id": calendarId,
    "operation.name": "ingest:source",
    "operation.type": "ingest",
  };

  const startTime = Date.now();
  let flushed = false;

  try {
    const [fetchResult, storedEvents] = await Promise.all([
      fetchEvents(),
      readExistingEvents(),
    ]);

    wideEvent["source_events.count"] = fetchResult.events.length;
    wideEvent["existing_events.count"] = storedEvents.length;

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

    const existingEvents = parseStoredSourceEventStates(storedEvents);

    const eventsToAdd = buildSourceEventsToAdd(existingEvents, fetchResult.events, {
      isDeltaSync: fetchResult.isDeltaSync ?? false,
    });

    const eventStateIdsToRemove = buildSourceEventStateIdsToRemove(
      existingEvents,
      fetchResult.events,
      {
        changedEventIds: fetchResult.changedEventIds,
        cancelledEventIds: fetchResult.cancelledEventIds,
        isDeltaSync: fetchResult.isDeltaSync ?? false,
      },
    );

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
  } catch (error) {
    wideEvent["outcome"] = "error";
    wideEvent["flushed"] = flushed;

    if (error instanceof Error) {
      wideEvent["error.message"] = error.message;
      wideEvent["error.type"] = error.constructor.name;
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
  IngestionResult,
  IngestionChanges,
  FetchEventsResult,
};
