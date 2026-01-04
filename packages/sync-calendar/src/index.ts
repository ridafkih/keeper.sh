import {
  remoteICalSourcesTable,
  eventStatesTable,
  calendarSnapshotsTable,
} from "@keeper.sh/database/schema";
import { pullRemoteCalendar } from "@keeper.sh/pull-calendar";
import { parseIcsEvents, diffEvents } from "@keeper.sh/sync-events";
import { convertIcsCalendar } from "ts-ics";
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

  const removeEvents = async (_sourceId: string, eventIds: string[]) => {
    await database
      .delete(eventStatesTable)
      .where(inArray(eventStatesTable.id, eventIds));
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
  };

  const createSnapshot = async (sourceId: string, ical: string) => {
    await database.insert(calendarSnapshotsTable).values({ sourceId, ical });
  };

  const syncSourceFromSnapshot = async (source: Source) => {
    const icsCalendar = await getLatestSnapshot(source.id);
    if (!icsCalendar) {
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
  };

  const fetchAndSyncSource = async (source: Source) => {
    const { ical } = await pullRemoteCalendar("ical", source.url);
    await createSnapshot(source.id, ical);
    await syncSourceFromSnapshot(source);
  };

  return { createSnapshot, syncSourceFromSnapshot, fetchAndSyncSource };
};
