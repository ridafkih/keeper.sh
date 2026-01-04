import {
  remoteICalSourcesTable,
  eventStatesTable,
  calendarSnapshotsTable,
  calendarDestinationsTable,
  eventMappingsTable,
} from "@keeper.sh/database/schema";
import { convertIcsCalendar } from "ts-ics";
import { eq, inArray, desc } from "drizzle-orm";
import { parseIcsEvents } from "./parse-ics-events";
import { diffEvents } from "./diff-events";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

export type Source = typeof remoteICalSourcesTable.$inferSelect;

const getLatestSnapshot = async (
  database: BunSQLDatabase,
  sourceId: string,
) => {
  const [snapshot] = await database
    .select({ ical: calendarSnapshotsTable.ical })
    .from(calendarSnapshotsTable)
    .where(eq(calendarSnapshotsTable.sourceId, sourceId))
    .orderBy(desc(calendarSnapshotsTable.createdAt))
    .limit(1);

  if (!snapshot?.ical) return null;
  return convertIcsCalendar(undefined, snapshot.ical);
};

const getStoredEvents = async (database: BunSQLDatabase, sourceId: string) => {
  return database
    .select({
      id: eventStatesTable.id,
      uid: eventStatesTable.sourceEventUid,
      startTime: eventStatesTable.startTime,
      endTime: eventStatesTable.endTime,
    })
    .from(eventStatesTable)
    .where(eq(eventStatesTable.sourceId, sourceId));
};

const getUserMappedDestinationUids = async (
  database: BunSQLDatabase,
  userId: string,
): Promise<Set<string>> => {
  const results = await database
    .select({ destinationEventUid: eventMappingsTable.destinationEventUid })
    .from(eventMappingsTable)
    .innerJoin(
      calendarDestinationsTable,
      eq(eventMappingsTable.destinationId, calendarDestinationsTable.id),
    )
    .where(eq(calendarDestinationsTable.userId, userId));

  return new Set(
    results.map(({ destinationEventUid }) => destinationEventUid),
  );
};

const removeEvents = async (
  database: BunSQLDatabase,
  _sourceId: string,
  events: { id: string; startTime: Date; endTime: Date }[],
) => {
  const eventIds = events.map(({ id }) => id);

  await database
    .delete(eventStatesTable)
    .where(inArray(eventStatesTable.id, eventIds));
};

const addEvents = async (
  database: BunSQLDatabase,
  sourceId: string,
  events: { uid: string; startTime: Date; endTime: Date }[],
) => {
  const rows = events.map((event) => ({
    sourceId,
    sourceEventUid: event.uid,
    startTime: event.startTime,
    endTime: event.endTime,
  }));

  await database.insert(eventStatesTable).values(rows);
};

type StoredEvent = Awaited<ReturnType<typeof getStoredEvents>>[number];
type StoredEventWithUid = StoredEvent & { uid: string };

const hasUid = (event: StoredEvent): event is StoredEventWithUid => {
  return event.uid !== null;
};

const partitionStoredEvents = (events: StoredEvent[]) => {
  const legacyEvents: StoredEvent[] = [];
  const eventsWithUid: StoredEventWithUid[] = [];

  for (const event of events) {
    if (hasUid(event)) {
      eventsWithUid.push(event);
    } else {
      legacyEvents.push(event);
    }
  }

  return { legacyEvents, eventsWithUid };
};

export async function syncSourceFromSnapshot(
  database: BunSQLDatabase,
  source: Source,
) {
  const icsCalendar = await getLatestSnapshot(database, source.id);
  if (!icsCalendar) {
    return;
  }

  const [parsedEvents, mappedUids, storedEvents] = await Promise.all([
    Promise.resolve(parseIcsEvents(icsCalendar)),
    getUserMappedDestinationUids(database, source.userId),
    getStoredEvents(database, source.id),
  ]);

  const remoteEvents = parsedEvents.filter(
    (event) => !mappedUids.has(event.uid),
  );

  const { legacyEvents, eventsWithUid } = partitionStoredEvents(storedEvents);
  const { toAdd, toRemove } = diffEvents(remoteEvents, eventsWithUid);

  const eventsToRemove = [...legacyEvents, ...toRemove];

  if (eventsToRemove.length > 0) {
    await removeEvents(database, source.id, eventsToRemove);
  }

  if (toAdd.length > 0) {
    await addEvents(database, source.id, toAdd);
  }
}
