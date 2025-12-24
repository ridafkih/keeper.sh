import type { EventTimeSlot, StoredEventTimeSlot, EventDiff } from "../types";

const timeSlotKey = (slot: EventTimeSlot): string =>
  `${slot.startTime.getTime()}:${slot.endTime.getTime()}`;

export const diffEvents = (
  remote: EventTimeSlot[],
  stored: StoredEventTimeSlot[],
): EventDiff => {
  const remoteCounts = new Map<string, number>();
  for (const event of remote) {
    const key = timeSlotKey(event);
    remoteCounts.set(key, (remoteCounts.get(key) ?? 0) + 1);
  }

  const storedCounts = new Map<string, number>();
  const storedByKey = new Map<string, StoredEventTimeSlot[]>();
  for (const event of stored) {
    const key = timeSlotKey(event);
    storedCounts.set(key, (storedCounts.get(key) ?? 0) + 1);
    const existing = storedByKey.get(key) ?? [];
    existing.push(event);
    storedByKey.set(key, existing);
  }

  const toAdd: EventTimeSlot[] = [];
  const toRemove: StoredEventTimeSlot[] = [];

  for (const event of remote) {
    const key = timeSlotKey(event);
    const remoteCount = remoteCounts.get(key) ?? 0;
    const storedCount = storedCounts.get(key) ?? 0;

    if (remoteCount > storedCount) {
      const diff = remoteCount - storedCount;
      for (let i = 0; i < diff; i++) {
        toAdd.push(event);
      }
      remoteCounts.set(key, storedCount);
    }
  }

  for (const [key, events] of storedByKey) {
    const remoteCount = remoteCounts.get(key) ?? 0;
    const storedCount = storedCounts.get(key) ?? 0;

    if (storedCount > remoteCount) {
      const diff = storedCount - remoteCount;
      for (let i = 0; i < diff; i++) {
        const event = events[i];
        if (event) toRemove.push(event);
      }
    }
  }

  return { toAdd, toRemove };
};
