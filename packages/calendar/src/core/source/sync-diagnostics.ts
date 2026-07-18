import type { SourceEvent } from "../types";
import type { OAuthSyncWindow } from "../oauth/sync-window";
import type { ExistingSourceEventState } from "./event-diff";
import { buildSourceEventInstanceKey } from "./event-instance";

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

const isSourceEventInWindow = (event: SourceEvent, syncWindow: OAuthSyncWindow): boolean =>
  event.endTime >= syncWindow.timeMin && event.startTime <= syncWindow.timeMax;

const filterSourceEventsToSyncWindow = (
  events: SourceEvent[],
  syncWindow: OAuthSyncWindow,
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
