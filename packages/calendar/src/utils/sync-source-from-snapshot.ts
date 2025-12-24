import { database } from "@keeper.sh/database";
import {
  remoteICalSourcesTable,
  eventStatesTable,
  calendarSnapshotsTable,
} from "@keeper.sh/database/schema";
import { convertIcsCalendar } from "ts-ics";
import { log } from "@keeper.sh/log";
import { eq, inArray, desc } from "drizzle-orm";
import { parseIcsEvents } from "./parse-ics-events";
import { diffEvents } from "./diff-events";

export type Source = typeof remoteICalSourcesTable.$inferSelect;

const getLatestSnapshot = async (sourceId: string) => {
  const [snapshot] = await database
    .select({ ical: calendarSnapshotsTable.ical })
    .from(calendarSnapshotsTable)
    .where(eq(calendarSnapshotsTable.sourceId, sourceId))
    .orderBy(desc(calendarSnapshotsTable.createdAt))
    .limit(1);

  if (!snapshot?.ical) return null;
  return convertIcsCalendar(undefined, snapshot.ical);
};

const getStoredEvents = async (sourceId: string) => {
  return database
    .select({
      id: eventStatesTable.id,
      startTime: eventStatesTable.startTime,
      endTime: eventStatesTable.endTime,
    })
    .from(eventStatesTable)
    .where(eq(eventStatesTable.sourceId, sourceId));
};

const removeEvents = async (sourceId: string, eventIds: string[]) => {
  await database
    .delete(eventStatesTable)
    .where(inArray(eventStatesTable.id, eventIds));

  log.debug("removed %s events from source '%s'", eventIds.length, sourceId);
};

const addEvents = async (
  sourceId: string,
  events: { startTime: Date; endTime: Date }[],
) => {
  const rows = events.map((event) => ({
    sourceId,
    startTime: event.startTime,
    endTime: event.endTime,
  }));

  await database.insert(eventStatesTable).values(rows);
  log.debug("added %s events to source '%s'", events.length, sourceId);
};

export async function syncSourceFromSnapshot(source: Source) {
  log.trace("syncSourceFromSnapshot for source '%s' started", source.id);

  const icsCalendar = await getLatestSnapshot(source.id);
  if (!icsCalendar) {
    log.debug("no snapshot found for source '%s'", source.id);
    log.trace("syncSourceFromSnapshot for source '%s' complete", source.id);
    return;
  }

  const remoteEvents = parseIcsEvents(icsCalendar);
  const storedEvents = await getStoredEvents(source.id);
  const { toAdd, toRemove } = diffEvents(remoteEvents, storedEvents);

  if (toRemove.length > 0) {
    const eventIds = toRemove.map((event) => event.id);
    await removeEvents(source.id, eventIds);
  }

  if (toAdd.length > 0) {
    await addEvents(source.id, toAdd);
  }

  if (toAdd.length === 0 && toRemove.length === 0) {
    log.debug("source '%s' is in sync", source.id);
  }

  log.trace("syncSourceFromSnapshot for source '%s' complete", source.id);
}
