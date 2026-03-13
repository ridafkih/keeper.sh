import { diffEvents } from "./diff-events";
import type { EventTimeSlot, StoredEventTimeSlot } from "./types";

interface SnapshotStoredEvent extends Omit<StoredEventTimeSlot, "uid"> {
  uid: string | null;
}

interface SnapshotSyncPlanInput {
  mappedDestinationUids: Set<string>;
  parsedEvents: EventTimeSlot[];
  storedEvents: SnapshotStoredEvent[];
}

interface SnapshotSyncPlan {
  toAdd: EventTimeSlot[];
  toRemove: SnapshotStoredEvent[];
}

const buildSnapshotSyncPlan = ({
  mappedDestinationUids,
  parsedEvents,
  storedEvents,
}: SnapshotSyncPlanInput): SnapshotSyncPlan => {
  const remoteEvents = parsedEvents.filter((event) => !mappedDestinationUids.has(event.uid));

  const eventsWithUid: StoredEventTimeSlot[] = [];
  const legacyEvents: SnapshotStoredEvent[] = [];

  for (const event of storedEvents) {
    if (event.uid === null) {
      legacyEvents.push(event);
      continue;
    }

    eventsWithUid.push({
      ...event,
      uid: event.uid,
    });
  }

  const { toAdd, toRemove } = diffEvents(remoteEvents, eventsWithUid);

  return {
    toAdd,
    toRemove: [...legacyEvents, ...toRemove],
  };
};

export { buildSnapshotSyncPlan };
export type { SnapshotStoredEvent, SnapshotSyncPlan, SnapshotSyncPlanInput };
