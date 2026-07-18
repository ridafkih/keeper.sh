import {
  materializeRecurrenceEvents,
  parseStoredRecurrenceForMaterialization,
} from "@keeper.sh/calendar";
import type { MaterializedSyncableEvent, SyncableEvent } from "@keeper.sh/calendar";

import type { KeeperEvent, KeeperEventFilters } from "@/types";

const API_OCCURRENCE_PREFIX = "occurrence";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SourceInfo {
  name: string;
  provider: string;
  url: string | null;
  userId: string;
}

interface SyncedEventRow {
  availability: string | null;
  calendarId: string;
  description: string | null;
  endTime: Date;
  exceptionDates: string | null;
  id: string;
  isAllDay: boolean | null;
  location: string | null;
  recurrenceId: Date | null;
  recurrenceRule: string | null;
  sourceEventUid: string | null;
  startTime: Date;
  startTimeZone: string | null;
  title: string | null;
}

interface EventReference {
  occurrenceStart: Date | null;
  resourceId: string;
}

interface KeeperEventProjection {
  calendarId: string;
  description: string | null;
  endTime: Date;
  eventStateId: string | null;
  id: string;
  location: string | null;
  startTime: Date;
  title: string | null;
}

const orAbsent = <TValue>(value: TValue | null): TValue | undefined => {
  if (value === null) {
    return;
  }
  return value;
};

const parseAvailability = (
  value: string | null,
): NonNullable<SyncableEvent["availability"]> | null => {
  if (
    value === "busy"
    || value === "free"
    || value === "oof"
    || value === "workingElsewhere"
  ) {
    return value;
  }
  return null;
};

const createOccurrenceEventId = (eventStateId: string, startTime: Date): string =>
  `${API_OCCURRENCE_PREFIX}:${eventStateId}:${startTime.getTime()}`;

const parseEventReference = (eventId: string): EventReference | null => {
  if (UUID_PATTERN.test(eventId)) {
    return { occurrenceStart: null, resourceId: eventId };
  }

  const parts = eventId.split(":");
  if (parts.length !== 3) {
    return null;
  }
  const [prefix, resourceId, rawOccurrenceStart] = parts;
  if (
    prefix !== API_OCCURRENCE_PREFIX
    || !resourceId
    || !UUID_PATTERN.test(resourceId)
    || !rawOccurrenceStart
    || !/^-?\d+$/.test(rawOccurrenceStart)
  ) {
    return null;
  }

  const occurrenceTimestamp = Number(rawOccurrenceStart);
  if (!Number.isSafeInteger(occurrenceTimestamp)) {
    return null;
  }
  const occurrenceStart = new Date(occurrenceTimestamp);
  if (Number.isNaN(occurrenceStart.getTime())) {
    return null;
  }

  return { occurrenceStart, resourceId };
};

const toSyncableEvent = (
  row: SyncedEventRow,
  source: SourceInfo,
): SyncableEvent => {
  const recurrence = parseStoredRecurrenceForMaterialization({
    eventId: row.id,
    exceptionDates: row.exceptionDates,
    recurrenceId: row.recurrenceId,
    recurrenceRule: row.recurrenceRule,
  });

  return {
    availability: orAbsent(parseAvailability(row.availability)),
    calendarId: row.calendarId,
    calendarName: source.name,
    calendarUrl: source.url,
    description: orAbsent(row.description),
    endTime: row.endTime,
    eventStateId: row.id,
    ...recurrence,
    id: row.id,
    isAllDay: orAbsent(row.isAllDay),
    location: orAbsent(row.location),
    sourceEventUid: row.sourceEventUid ?? row.id,
    startTime: row.startTime,
    startTimeZone: orAbsent(row.startTimeZone),
    summary: row.title ?? "",
  };
};

const toSyncedProjection = (
  occurrence: MaterializedSyncableEvent,
): KeeperEventProjection => {
  const { id: originalId } = occurrence;
  const eventStateId = occurrence.eventStateId ?? originalId;
  const isMaterializedOccurrence = originalId !== eventStateId;
  let id = originalId;
  if (isMaterializedOccurrence) {
    id = createOccurrenceEventId(eventStateId, occurrence.startTime);
  }

  return {
    calendarId: occurrence.calendarId,
    description: occurrence.description ?? null,
    endTime: occurrence.endTime,
    eventStateId,
    id,
    location: occurrence.location ?? null,
    startTime: occurrence.startTime,
    title: occurrence.summary || null,
  };
};

const isIncludedByFilters = (
  occurrence: MaterializedSyncableEvent,
  filters?: KeeperEventFilters,
): boolean => {
  if (
    filters?.availability
    && filters.availability.length > 0
    && !filters.availability.includes(occurrence.availability ?? "")
  ) {
    return false;
  }
  if (
    filters
    && "isAllDay" in filters
    && typeof filters.isAllDay === "boolean"
    && occurrence.isAllDay !== filters.isAllDay
  ) {
    return false;
  }
  return true;
};

const projectSyncedEvents = (
  rows: SyncedEventRow[],
  sourceMap: Map<string, SourceInfo>,
  windowStart: Date,
  windowEnd: Date,
  filters?: KeeperEventFilters,
): KeeperEventProjection[] => {
  const events = rows.flatMap((row) => {
    const source = sourceMap.get(row.calendarId);
    if (!source) {
      return [];
    }
    return [toSyncableEvent(row, source)];
  });
  const exclusiveWindowEnd = new Date(windowEnd.getTime() + 1);

  return materializeRecurrenceEvents(events, {
    end: exclusiveWindowEnd,
    start: windowStart,
  })
    .filter((occurrence) => isIncludedByFilters(occurrence, filters))
    .map((occurrence) => toSyncedProjection(occurrence));
};

const toKeeperEvent = (
  event: KeeperEventProjection,
  source: SourceInfo,
): KeeperEvent => ({
  calendarId: event.calendarId,
  calendarName: source.name,
  calendarProvider: source.provider,
  calendarUrl: source.url,
  description: event.description,
  endTime: event.endTime.toISOString(),
  eventStateId: event.eventStateId,
  id: event.id,
  location: event.location,
  startTime: event.startTime.toISOString(),
  title: event.title,
});

export {
  parseEventReference,
  projectSyncedEvents,
  toKeeperEvent,
  toSyncableEvent,
};
export type {
  EventReference,
  KeeperEventProjection,
  SourceInfo,
  SyncedEventRow,
};
