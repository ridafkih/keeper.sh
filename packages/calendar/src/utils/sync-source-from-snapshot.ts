import {
  calendarsTable,
  calendarSnapshotsTable,
  eventMappingsTable,
  eventStatesTable,
} from "@keeper.sh/database/schema";
import { parseIcsCalendar } from "./parse-ics-calendar";
import { desc, eq, inArray } from "drizzle-orm";
import { parseIcsEvents } from "./parse-ics-events";
import { buildSnapshotSyncPlan } from "./snapshot-sync-plan";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const FIRST_SNAPSHOT_INDEX = 1;
const MINIMUM_EVENTS_TO_PROCESS = 0;

type Source = typeof calendarsTable.$inferSelect;
interface StoredEventRow {
  availability: string | null;
  endTime: Date;
  exceptionDates: string | null;
  id: string;
  isAllDay: boolean | null;
  recurrenceRule: string | null;
  sourceEventType: string | null;
  startTime: Date;
  startTimeZone: string | null;
  uid: string | null;
}
type StoredEvent = Omit<
  StoredEventRow,
  "exceptionDates" | "recurrenceRule" | "startTimeZone" | "availability" | "isAllDay" | "sourceEventType"
> & {
  availability?: "busy" | "free" | "oof" | "workingElsewhere";
  exceptionDates?: object;
  isAllDay?: boolean;
  recurrenceRule?: object;
  sourceEventType?: string;
  startTimeZone?: string;
};

const getLatestSnapshot = async (
  database: BunSQLDatabase,
  calendarId: string,
): Promise<ReturnType<typeof parseIcsCalendar> | null> => {
  const [snapshot] = await database
    .select({ ical: calendarSnapshotsTable.ical })
    .from(calendarSnapshotsTable)
    .where(eq(calendarSnapshotsTable.calendarId, calendarId))
    .orderBy(desc(calendarSnapshotsTable.createdAt))
    .limit(FIRST_SNAPSHOT_INDEX);

  if (!snapshot?.ical) {
    return null;
  }
  return parseIcsCalendar({ icsString: snapshot.ical });
};

const parseOptionalJson = (value: string | null): object | null => {
  if (value === null) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(value);
    if (parsedValue !== null && typeof parsedValue === "object") {
      return parsedValue;
    }
    return null;
  } catch {
    return null;
  }
};

const toStoredEvent = (row: StoredEventRow): StoredEvent => {
  const storedEvent: StoredEvent = {
    endTime: row.endTime,
    id: row.id,
    startTime: row.startTime,
    uid: row.uid,
  };

  if (row.availability !== null) {
    storedEvent.availability = row.availability as StoredEvent["availability"];
  }

  if (row.isAllDay !== null) {
    storedEvent.isAllDay = row.isAllDay;
  }

  if (row.sourceEventType !== null) {
    storedEvent.sourceEventType = row.sourceEventType;
  }

  if (row.startTimeZone !== null) {
    storedEvent.startTimeZone = row.startTimeZone;
  }

  const recurrenceRule = parseOptionalJson(row.recurrenceRule);
  if (recurrenceRule) {
    storedEvent.recurrenceRule = recurrenceRule;
  }

  const exceptionDates = parseOptionalJson(row.exceptionDates);
  if (exceptionDates) {
    storedEvent.exceptionDates = exceptionDates;
  }

  return storedEvent;
};

const getStoredEvents = async (
  database: BunSQLDatabase,
  calendarId: string,
): Promise<StoredEvent[]> => {
  const rows = await database
    .select({
      availability: eventStatesTable.availability,
      endTime: eventStatesTable.endTime,
      exceptionDates: eventStatesTable.exceptionDates,
      id: eventStatesTable.id,
      isAllDay: eventStatesTable.isAllDay,
      recurrenceRule: eventStatesTable.recurrenceRule,
      sourceEventType: eventStatesTable.sourceEventType,
      startTime: eventStatesTable.startTime,
      startTimeZone: eventStatesTable.startTimeZone,
      uid: eventStatesTable.sourceEventUid,
    })
    .from(eventStatesTable)
    .where(eq(eventStatesTable.calendarId, calendarId));

  return rows.map((row) => toStoredEvent(row));
};

const getUserMappedDestinationUids = async (
  database: BunSQLDatabase,
  userId: string,
): Promise<Set<string>> => {
  const results = await database
    .select({ destinationEventUid: eventMappingsTable.destinationEventUid })
    .from(eventMappingsTable)
    .innerJoin(
      calendarsTable,
      eq(eventMappingsTable.calendarId, calendarsTable.id),
    )
    .where(eq(calendarsTable.userId, userId));

  return new Set(results.map(({ destinationEventUid }) => destinationEventUid));
};

const removeEvents = async (
  database: BunSQLDatabase,
  events: { id: string; startTime: Date; endTime: Date }[],
): Promise<void> => {
  const eventIds = events.map(({ id }) => id);

  await database.delete(eventStatesTable).where(inArray(eventStatesTable.id, eventIds));
};

const addEvents = async (
  database: BunSQLDatabase,
  calendarId: string,
  events: {
    uid: string;
    startTime: Date;
    endTime: Date;
    availability?: "busy" | "free" | "oof" | "workingElsewhere";
    isAllDay?: boolean;
    startTimeZone?: string;
    title?: string;
    description?: string;
    location?: string;
    recurrenceRule?: object;
    exceptionDates?: object;
    sourceEventType?: string;
  }[],
): Promise<void> => {
  const rows = events.map((event) => {
    const row: {
      calendarId: string;
      availability?: string;
      description?: string;
      endTime: Date;
      exceptionDates?: string;
      isAllDay?: boolean;
      location?: string;
      recurrenceRule?: string;
      sourceEventType?: string;
      sourceEventUid: string;
      startTime: Date;
      startTimeZone?: string;
      title?: string;
    } = {
      calendarId,
      availability: event.availability,
      description: event.description,
      endTime: event.endTime,
      isAllDay: event.isAllDay,
      location: event.location,
      sourceEventType: event.sourceEventType ?? "default",
      sourceEventUid: event.uid,
      startTime: event.startTime,
      startTimeZone: event.startTimeZone,
      title: event.title,
    };

    if (event.exceptionDates) {
      row.exceptionDates = JSON.stringify(event.exceptionDates);
    }
    if (event.recurrenceRule) {
      row.recurrenceRule = JSON.stringify(event.recurrenceRule);
    }

    return row;
  });

  await database.insert(eventStatesTable).values(rows);
};

const syncSourceFromSnapshot = async (database: BunSQLDatabase, source: Source): Promise<void> => {
  const icsCalendar = await getLatestSnapshot(database, source.id);
  if (!icsCalendar) {
    return;
  }

  const [parsedEvents, mappedUids, storedEvents] = await Promise.all([
    Promise.resolve(parseIcsEvents(icsCalendar)),
    getUserMappedDestinationUids(database, source.userId),
    getStoredEvents(database, source.id),
  ]);

  const { toAdd, toRemove: eventsToRemove } = buildSnapshotSyncPlan({
    mappedDestinationUids: mappedUids,
    parsedEvents,
    storedEvents,
  });

  if (eventsToRemove.length > MINIMUM_EVENTS_TO_PROCESS) {
    await removeEvents(database, eventsToRemove);
  }

  if (toAdd.length > MINIMUM_EVENTS_TO_PROCESS) {
    await addEvents(database, source.id, toAdd);
  }
};

export { syncSourceFromSnapshot };
export type { Source };
