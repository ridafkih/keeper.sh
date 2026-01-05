import type { EventDiff, EventTimeSlot, StoredEventTimeSlot } from "../types";

const eventIdentityKey = (event: EventTimeSlot): string =>
  `${event.uid}:${event.startTime.getTime()}:${event.endTime.getTime()}`;

const diffEvents = (remote: EventTimeSlot[], stored: StoredEventTimeSlot[]): EventDiff => {
  const remoteByKey = new Map<string, EventTimeSlot>();
  for (const event of remote) {
    remoteByKey.set(eventIdentityKey(event), event);
  }

  const storedByKey = new Map<string, StoredEventTimeSlot>();
  for (const event of stored) {
    storedByKey.set(eventIdentityKey(event), event);
  }

  const toAdd: EventTimeSlot[] = [];
  const toRemove: StoredEventTimeSlot[] = [];

  for (const [key, event] of remoteByKey) {
    if (!storedByKey.has(key)) {
      toAdd.push(event);
    }
  }

  for (const [key, event] of storedByKey) {
    if (!remoteByKey.has(key)) {
      toRemove.push(event);
    }
  }

  return { toAdd, toRemove };
};

export { diffEvents };
