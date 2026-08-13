import type { SourceEvent } from "../types";
import type { SyncWindow } from "../sync/sync-range";
import type { ExistingSourceEventState } from "./event-diff";
import { buildSourceEventInstanceKey } from "./event-instance";
import { materializeRecurrenceEvents } from "../events/recurrence-materializer";
import { overlapsTimeWindow } from "../events/time-range";

interface SourceEventsInWindowResult {
  events: SourceEvent[];
  filteredCount: number;
}

interface SourceEventStoragePartition {
  eventsToInsert: SourceEvent[];
  eventsToUpdate: SourceEvent[];
}

interface SourceSyncTokenAction {
  nextSyncTokenToPersist?: string;
  shouldResetSyncToken: boolean;
}

const isSourceEventInWindow = (event: SourceEvent, syncWindow: SyncWindow): boolean => {
  if (!event.recurrenceRule || event.recurrenceId) {
    return overlapsTimeWindow(event, syncWindow.timeMin, syncWindow.timeMax);
  }

  let isOverBudget = false;
  const occurrences = materializeRecurrenceEvents([{
    calendarId: "sync-window-filter",
    calendarName: null,
    calendarUrl: null,
    endTime: event.endTime,
    exceptionDates: event.exceptionDates?.map(({ date }) => date),
    id: event.sourceEventId ?? event.uid,
    recurrenceDuration: event.recurrenceDuration,
    recurrenceRule: event.recurrenceRule,
    sourceEventUid: event.uid,
    startTime: event.startTime,
    startTimeZone: event.startTimeZone,
    summary: event.title ?? "",
  }], {
    end: syncWindow.timeMax,
    start: syncWindow.timeMin,
  }, {
    onSeriesOverBudget: () => {
      isOverBudget = true;
    },
  });

  /*
   * A series over the occurrence budget certainly overlaps the window, so keep it.
   * Throwing here would fail the whole fetch before ingestion's budget scan could
   * withhold and report the series, putting the entire calendar into backoff.
   */
  return isOverBudget || occurrences.length > 0;
};

const filterSourceEventsToSyncWindow = (
  events: SourceEvent[],
  syncWindow: SyncWindow,
): SourceEventsInWindowResult => {
  const eventsInWindow = events.filter((event) => isSourceEventInWindow(event, syncWindow));
  return {
    events: eventsInWindow,
    filteredCount: events.length - eventsInWindow.length,
  };
};

const splitSourceEventsByPersistenceIdentity = (
  existingEvents: ExistingSourceEventState[],
  eventsToAdd: SourceEvent[],
): SourceEventStoragePartition => {
  const existingProviderIds = new Set(
    existingEvents.flatMap((event) => {
      if (!event.sourceEventId) {
        return [];
      }
      return [event.sourceEventId];
    }),
  );
  const existingStorageIdentities = new Set(
    existingEvents.flatMap((event) => {
      if (event.sourceEventId || event.sourceEventUid === null) {
        return [];
      }
      return [buildSourceEventInstanceKey({
        endTime: event.endTime,
        recurrenceId: event.recurrenceId,
        startTime: event.startTime,
        uid: event.sourceEventUid,
      })];
    }),
  );

  const eventsToInsert: SourceEvent[] = [];
  const eventsToUpdate: SourceEvent[] = [];

  for (const event of eventsToAdd) {
    if (event.sourceEventId) {
      if (existingProviderIds.has(event.sourceEventId)) {
        eventsToUpdate.push(event);
      } else {
        eventsToInsert.push(event);
      }
      continue;
    }

    const storageIdentity = buildSourceEventInstanceKey(event);

    if (existingStorageIdentities.has(storageIdentity)) {
      eventsToUpdate.push(event);
      continue;
    }

    eventsToInsert.push(event);
  }

  return { eventsToInsert, eventsToUpdate };
};

const resolveSourceSyncTokenAction = (
  nextSyncToken: string | undefined,
  isDeltaSync: boolean | undefined,
): SourceSyncTokenAction => {
  if (nextSyncToken) {
    return { nextSyncTokenToPersist: nextSyncToken, shouldResetSyncToken: false };
  }

  if (isDeltaSync) {
    return { shouldResetSyncToken: true };
  }

  return { shouldResetSyncToken: false };
};

export {
  filterSourceEventsToSyncWindow,
  resolveSourceSyncTokenAction,
  splitSourceEventsByPersistenceIdentity,
};
export type {
  SourceEventsInWindowResult,
  SourceEventStoragePartition,
  SourceSyncTokenAction,
};
