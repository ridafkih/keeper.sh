import type { SourceEvent } from "../types";
import { buildSourceEventsToAdd, buildSourceEventStateIdsToRemove } from "../source/event-diff";

interface ExistingEventState {
  id: string;
  sourceEventUid: string | null;
  startTime: Date;
  endTime: Date;
  availability: string | null;
  isAllDay: boolean | null;
  sourceEventType: string | null;
}

interface FetchEventsResult {
  events: SourceEvent[];
  nextSyncToken?: string;
  cancelledEventUids?: string[];
  isDeltaSync?: boolean;
  fullSyncRequired?: boolean;
}

interface IngestionChanges {
  inserts: SourceEvent[];
  deletes: string[];
  syncToken?: string | null;
}

interface IngestSourceOptions {
  calendarId: string;
  fetchEvents: () => Promise<FetchEventsResult>;
  readExistingEvents: () => Promise<ExistingEventState[]>;
  isCurrent: () => Promise<boolean>;
  flush: (changes: IngestionChanges) => Promise<void>;
  onIngestEvent?: (event: Record<string, unknown>) => void;
}

interface IngestionResult {
  eventsAdded: number;
  eventsRemoved: number;
}

const EMPTY_RESULT: IngestionResult = { eventsAdded: 0, eventsRemoved: 0 };

const ingestSource = async (options: IngestSourceOptions): Promise<IngestionResult> => {
  const { calendarId, fetchEvents, readExistingEvents, isCurrent, flush, onIngestEvent } = options;

  const wideEvent: Record<string, unknown> = {
    "calendar.id": calendarId,
    "operation.name": "ingest:source",
    "operation.type": "ingest",
  };

  const startTime = Date.now();
  let flushed = false;

  try {
    const [fetchResult, existingEvents] = await Promise.all([
      fetchEvents(),
      readExistingEvents(),
    ]);

    wideEvent["source_events.count"] = fetchResult.events.length;
    wideEvent["existing_events.count"] = existingEvents.length;

    if (fetchResult.fullSyncRequired) {
      const canFlushReset = await isCurrent();
      if (!canFlushReset) {
        wideEvent["outcome"] = "superseded";
        wideEvent["flushed"] = false;
        return EMPTY_RESULT;
      }

      wideEvent["outcome"] = "full-sync-required";
      wideEvent["flushed"] = true;
      await flush({ inserts: [], deletes: [], syncToken: null });
      flushed = true;
      return EMPTY_RESULT;
    }

    const stillCurrent = await isCurrent();
    if (!stillCurrent) {
      wideEvent["outcome"] = "superseded";
      wideEvent["flushed"] = false;
      return EMPTY_RESULT;
    }

    const eventsToAdd = buildSourceEventsToAdd(existingEvents, fetchResult.events, {
      isDeltaSync: fetchResult.isDeltaSync ?? false,
    });

    const eventStateIdsToRemove = buildSourceEventStateIdsToRemove(
      existingEvents,
      fetchResult.events,
      {
        cancelledEventUids: fetchResult.cancelledEventUids,
        isDeltaSync: fetchResult.isDeltaSync ?? false,
      },
    );

    wideEvent["events.added"] = eventsToAdd.length;
    wideEvent["events.removed"] = eventStateIdsToRemove.length;

    if (eventsToAdd.length === 0 && eventStateIdsToRemove.length === 0) {
      if (fetchResult.nextSyncToken) {
        const canFlushToken = await isCurrent();
        if (canFlushToken) {
          await flush({ inserts: [], deletes: [], syncToken: fetchResult.nextSyncToken });
          flushed = true;
          wideEvent["outcome"] = "in-sync";
          wideEvent["flushed"] = true;
          return EMPTY_RESULT;
        }
      }

      wideEvent["outcome"] = "in-sync";
      wideEvent["flushed"] = false;
      return EMPTY_RESULT;
    }

    const canFlush = await isCurrent();
    if (!canFlush) {
      wideEvent["outcome"] = "superseded";
      wideEvent["flushed"] = false;
      return EMPTY_RESULT;
    }

    await flush({
      inserts: eventsToAdd,
      deletes: eventStateIdsToRemove,
      syncToken: fetchResult.nextSyncToken,
    });

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
export type { IngestSourceOptions, IngestionResult, IngestionChanges, ExistingEventState, FetchEventsResult };
