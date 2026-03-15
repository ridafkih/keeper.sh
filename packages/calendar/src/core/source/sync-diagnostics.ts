import type { SourceEvent } from "../types";
import type { ExistingSourceEventState } from "./event-diff";

interface OAuthSyncWindow {
  timeMin: Date;
  timeMax: Date;
}

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

const buildSourceEventStorageIdentityKey = (
  uid: string,
  startTime: Date,
  endTime: Date,
): string => `${uid}|${startTime.toISOString()}|${endTime.toISOString()}`;

const splitSourceEventsByStorageIdentity = (
  existingEvents: ExistingSourceEventState[],
  eventsToAdd: SourceEvent[],
): SourceEventStoragePartition => {
  const existingStorageIdentities = new Set(
    existingEvents.flatMap((event) => {
      if (event.sourceEventUid === null) {
        return [];
      }
      return [
        buildSourceEventStorageIdentityKey(
          event.sourceEventUid,
          event.startTime,
          event.endTime,
        ),
      ];
    }),
  );

  const eventsToInsert: SourceEvent[] = [];
  const eventsToUpdate: SourceEvent[] = [];

  for (const event of eventsToAdd) {
    const storageIdentity = buildSourceEventStorageIdentityKey(
      event.uid,
      event.startTime,
      event.endTime,
    );

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
  splitSourceEventsByStorageIdentity,
};
export type {
  OAuthSyncWindow,
  SourceEventsInWindowResult,
  SourceEventStoragePartition,
  SourceSyncTokenAction,
};
