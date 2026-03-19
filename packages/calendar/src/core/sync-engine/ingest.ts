import type { SourceEvent } from "../types";
import { TransitionPolicy } from "@keeper.sh/state-machines";
import { createSourceDiffReconciliationRuntime } from "../source/source-diff-reconciliation-runtime";

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
    const [fetchResult, existingEvents] = await Promise.all([
      fetchEvents(),
      readExistingEvents(),
    ]);

    wideEvent["source_events.count"] = fetchResult.events.length;
    wideEvent["existing_events.count"] = existingEvents.length;

    if (fetchResult.fullSyncRequired) {
      wideEvent["outcome"] = "full-sync-required";
      wideEvent["flushed"] = true;
      await flush({ inserts: [], deletes: [], syncToken: null });
      flushed = true;
      return EMPTY_RESULT;
    }

    let eventsAdded = 0;
    let eventsRemoved = 0;
    let diffApplied = false;
    const runtime = createSourceDiffReconciliationRuntime({
      applyDiff: async (plan) => {
        diffApplied = true;
        eventsAdded = plan.addedCount + plan.updatedCount;
        eventsRemoved = plan.removedCount;

        const changes: IngestionChanges = {
          inserts: [...plan.eventsToInsert, ...plan.eventsToUpdate],
          deletes: plan.eventStateIdsToRemove,
        };

        if (typeof fetchResult.nextSyncToken === "string") {
          changes.syncToken = fetchResult.nextSyncToken;
        }

        await flush(changes);
        flushed = true;
      },
      fetchEvents: () =>
        Promise.resolve({
          events: fetchResult.events,
          isDeltaSync: fetchResult.isDeltaSync ?? false,
          cancelledEventUids: fetchResult.cancelledEventUids ?? [],
        }),
      isRetryableError: () => false,
      readExistingEvents: () => Promise.resolve(existingEvents),
      resolveErrorCode: (error) => {
        if (error instanceof Error) {
          return error.message.slice(0, 120);
        }
        return String(error).slice(0, 120);
      },
      sourceId: calendarId,
      transitionPolicy: TransitionPolicy.REJECT,
    });

    const transition = await runtime.reconcile({
      actor: { id: "ingest-source-runtime", type: "system" },
      id: `ingest-source:${calendarId}:${startTime}`,
      occurredAt: new Date(startTime).toISOString(),
    });

    if (!diffApplied) {
      if (fetchResult.nextSyncToken) {
        await flush({ inserts: [], deletes: [], syncToken: fetchResult.nextSyncToken });
        flushed = true;
        wideEvent["events.added"] = 0;
        wideEvent["events.removed"] = 0;
        wideEvent["outcome"] = "in-sync";
        wideEvent["flushed"] = true;
        return EMPTY_RESULT;
      }

      wideEvent["events.added"] = 0;
      wideEvent["events.removed"] = 0;
      wideEvent["outcome"] = "in-sync";
      wideEvent["flushed"] = false;
      return EMPTY_RESULT;
    }

    wideEvent["events.added"] = eventsAdded;
    wideEvent["events.removed"] = eventsRemoved;
    wideEvent["outcome"] = "error";
    if (transition.state === "completed") {
      wideEvent["outcome"] = "success";
    }
    wideEvent["flushed"] = true;

    return {
      eventsAdded,
      eventsRemoved,
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
