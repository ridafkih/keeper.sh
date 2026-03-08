import {
  calendarsTable,
  calendarSnapshotsTable,
  eventMappingsTable,
  eventStatesTable,
} from "@keeper.sh/database/schema";
import { parseIcsCalendar } from "./parse-ics-calendar";
import { desc, eq, inArray } from "drizzle-orm";
import { parseIcsEvents } from "./parse-ics-events";
import { diffEvents } from "./diff-events";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const FIRST_SNAPSHOT_INDEX = 1;
const MINIMUM_EVENTS_TO_PROCESS = 0;

type Source = typeof calendarsTable.$inferSelect;
type StoredEventRow = {
  endTime: Date;
  exceptionDates: string | null;
  id: string;
  recurrenceRule: string | null;
  startTime: Date;
  startTimeZone: string | null;
  uid: string | null;
};
type StoredEvent = Omit<
  StoredEventRow,
  "exceptionDates" | "recurrenceRule" | "startTimeZone"
> & {
  exceptionDates?: object;
  recurrenceRule?: object;
  startTimeZone?: string;
};
type StoredEventWithUid = StoredEvent & { uid: string };

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

const parseOptionalJson = (value: string | null): object | undefined => {
  if (value === null) {
    return undefined;
  }

  try {
    const parsedValue = JSON.parse(value);
    if (parsedValue !== null && typeof parsedValue === "object") {
      return parsedValue;
    }
    return undefined;
  } catch {
    return undefined;
  }
};

const toStoredEvent = (row: StoredEventRow): StoredEvent => {
  const storedEvent: StoredEvent = {
    endTime: row.endTime,
    id: row.id,
    startTime: row.startTime,
    uid: row.uid,
  };

  if (row.startTimeZone !== null) {
    storedEvent.startTimeZone = row.startTimeZone;
  }

  const recurrenceRule = parseOptionalJson(row.recurrenceRule);
  if (recurrenceRule !== undefined) {
    storedEvent.recurrenceRule = recurrenceRule;
  }

  const exceptionDates = parseOptionalJson(row.exceptionDates);
  if (exceptionDates !== undefined) {
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
      endTime: eventStatesTable.endTime,
      exceptionDates: eventStatesTable.exceptionDates,
      id: eventStatesTable.id,
      recurrenceRule: eventStatesTable.recurrenceRule,
      startTime: eventStatesTable.startTime,
      startTimeZone: eventStatesTable.startTimeZone,
      uid: eventStatesTable.sourceEventUid,
    })
    .from(eventStatesTable)
    .where(eq(eventStatesTable.calendarId, calendarId));

  return rows.map(toStoredEvent);
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
    startTimeZone?: string;
    title?: string;
    description?: string;
    location?: string;
    recurrenceRule?: object;
    exceptionDates?: object;
  }[],
): Promise<void> => {
  const rows = events.map((event) => ({
    calendarId,
    description: event.description,
    endTime: event.endTime,
    exceptionDates: event.exceptionDates ? JSON.stringify(event.exceptionDates) : undefined,
    location: event.location,
    recurrenceRule: event.recurrenceRule ? JSON.stringify(event.recurrenceRule) : undefined,
    sourceEventUid: event.uid,
    startTime: event.startTime,
    startTimeZone: event.startTimeZone,
    title: event.title,
  }));

  await database.insert(eventStatesTable).values(rows);
};

const hasUid = (event: StoredEvent): event is StoredEventWithUid => event.uid !== null;

const partitionStoredEvents = (
  events: StoredEvent[],
): { eventsWithUid: StoredEventWithUid[]; legacyEvents: StoredEvent[] } => {
  const legacyEvents: StoredEvent[] = [];
  const eventsWithUid: StoredEventWithUid[] = [];

  for (const event of events) {
    if (hasUid(event)) {
      eventsWithUid.push(event);
    } else {
      legacyEvents.push(event);
    }
  }

  return { eventsWithUid, legacyEvents };
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

  const remoteEvents = parsedEvents.filter((event) => !mappedUids.has(event.uid));

  const { legacyEvents, eventsWithUid } = partitionStoredEvents(storedEvents);
  const { toAdd, toRemove } = diffEvents(remoteEvents, eventsWithUid);

  const eventsToRemove = [...legacyEvents, ...toRemove];

  if (eventsToRemove.length > MINIMUM_EVENTS_TO_PROCESS) {
    await removeEvents(database, eventsToRemove);
  }

  if (toAdd.length > MINIMUM_EVENTS_TO_PROCESS) {
    await addEvents(database, source.id, toAdd);
  }
};

export { syncSourceFromSnapshot };
export type { Source };
