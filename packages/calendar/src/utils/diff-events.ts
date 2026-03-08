import type { EventDiff, EventTimeSlot, StoredEventTimeSlot } from "../types";

const normalizeTimeZone = (timeZone: string | null | undefined): string => timeZone ?? "";
const EMPTY_SERIALIZED_VALUE = "";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const toStableComparableValue = (value: unknown): unknown => {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toStableComparableValue(entry));
  }

  if (isRecord(value)) {
    const entries = Object.entries(value)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, nestedValue]) => [key, toStableComparableValue(nestedValue)]);

    return Object.fromEntries(entries);
  }

  return value;
};

const serializeOptionalValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return EMPTY_SERIALIZED_VALUE;
  }

  return JSON.stringify(toStableComparableValue(value));
};

const eventIdentityKey = (event: EventTimeSlot): string =>
  [
    event.uid,
    String(event.startTime.getTime()),
    String(event.endTime.getTime()),
    normalizeTimeZone(event.startTimeZone),
    serializeOptionalValue(event.recurrenceRule),
    serializeOptionalValue(event.exceptionDates),
  ].join(":");

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
