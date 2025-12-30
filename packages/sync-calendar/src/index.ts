import {
  remoteICalSourcesTable,
  eventStatesTable,
  calendarSnapshotsTable,
} from "@keeper.sh/database/schema";
import { pullRemoteCalendar } from "@keeper.sh/pull-calendar";
import { parseIcsEvents, diffEvents } from "@keeper.sh/sync-events";
import { convertIcsCalendar } from "ts-ics";
import { log } from "@keeper.sh/log";
import { eq, inArray, desc } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

export class RemoteCalendarSyncError extends Error {
  constructor(
    public sourceId: string,
    cause: unknown,
  ) {
    super(`Failed to sync remote calendar ${sourceId}`);
    this.cause = cause;
  }
}

export type Source = typeof remoteICalSourcesTable.$inferSelect;

export interface SyncCalendarService {
  createSnapshot: (sourceId: string, ical: string) => Promise<void>;
  syncSourceFromSnapshot: (source: Source) => Promise<void>;
  fetchAndSyncSource: (source: Source) => Promise<void>;
}

export const createSyncCalendarService = (
  database: BunSQLDatabase,
): SyncCalendarService => {
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

  const toStoredEvent = (row: {
    id: string;
    sourceEventUid: string;
    startTime: Date;
    endTime: Date;
  }) => ({
    id: row.id,
    uid: row.sourceEventUid,
    startTime: row.startTime,
    endTime: row.endTime,
  });

  const getStoredEvents = async (sourceId: string) => {
    const results = await database
      .select({
        id: eventStatesTable.id,
        sourceEventUid: eventStatesTable.sourceEventUid,
        startTime: eventStatesTable.startTime,
        endTime: eventStatesTable.endTime,
      })
      .from(eventStatesTable)
      .where(eq(eventStatesTable.sourceId, sourceId));

    const events = [];
    for (const row of results) {
      if (row.sourceEventUid === null) continue;
      events.push(toStoredEvent({ ...row, sourceEventUid: row.sourceEventUid }));
    }

    return events;
  };

  const removeEvents = async (sourceId: string, eventIds: string[]) => {
    await database
      .delete(eventStatesTable)
      .where(inArray(eventStatesTable.id, eventIds));

    log.debug("removed %s events from source '%s'", eventIds.length, sourceId);
  };

  const addEvents = async (
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
    log.debug("added %s events to source '%s'", events.length, sourceId);
  };

  const createSnapshot = async (sourceId: string, ical: string) => {
    log.trace("createSnapshot for source '%s' started", sourceId);
    await database.insert(calendarSnapshotsTable).values({ sourceId, ical });
    log.trace("createSnapshot for source '%s' complete", sourceId);
  };

  const syncSourceFromSnapshot = async (source: Source) => {
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
  };

  const fetchAndSyncSource = async (source: Source) => {
    log.trace("fetchAndSyncSource for source '%s' started", source.id);

    try {
      const { ical } = await pullRemoteCalendar("ical", source.url);
      await createSnapshot(source.id, ical);
      await syncSourceFromSnapshot(source);
      log.trace("fetchAndSyncSource for source '%s' complete", source.id);
    } catch (error) {
      const syncError = new RemoteCalendarSyncError(source.id, error);
      log.error(
        { error: syncError, sourceId: source.id },
        "failed to fetch and sync source",
      );
      throw syncError;
    }
  };

  return { createSnapshot, syncSourceFromSnapshot, fetchAndSyncSource };
};
