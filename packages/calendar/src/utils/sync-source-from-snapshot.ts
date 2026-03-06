import {
  calendarAccountsTable,
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

const getStoredEvents = (
  database: BunSQLDatabase,
  calendarId: string,
): Promise<
  {
    endTime: Date;
    id: string;
    startTime: Date;
    uid: string | null;
  }[]
> =>
  database
    .select({
      endTime: eventStatesTable.endTime,
      id: eventStatesTable.id,
      startTime: eventStatesTable.startTime,
      uid: eventStatesTable.sourceEventUid,
    })
    .from(eventStatesTable)
    .where(eq(eventStatesTable.calendarId, calendarId));

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
  _calendarId: string,
  events: { id: string; startTime: Date; endTime: Date }[],
): Promise<void> => {
  const eventIds = events.map(({ id }) => id);

  await database.delete(eventStatesTable).where(inArray(eventStatesTable.id, eventIds));
};

const addEvents = async (
  database: BunSQLDatabase,
  calendarId: string,
  events: { uid: string; startTime: Date; endTime: Date; title?: string; description?: string; location?: string }[],
): Promise<void> => {
  const rows = events.map((event) => ({
    calendarId,
    description: event.description,
    endTime: event.endTime,
    location: event.location,
    sourceEventUid: event.uid,
    startTime: event.startTime,
    title: event.title,
  }));

  await database.insert(eventStatesTable).values(rows);
};

type StoredEvent = Awaited<ReturnType<typeof getStoredEvents>>[number];
type StoredEventWithUid = StoredEvent & { uid: string };

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
    await removeEvents(database, source.id, eventsToRemove);
  }

  if (toAdd.length > MINIMUM_EVENTS_TO_PROCESS) {
    await addEvents(database, source.id, toAdd);
  }
};

export { syncSourceFromSnapshot };
export type { Source };
