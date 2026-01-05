import type { remoteICalSourcesTable } from "@keeper.sh/database/schema";
import { calendarSnapshotsTable, eventStatesTable } from "@keeper.sh/database/schema";
import { pullRemoteCalendar } from "@keeper.sh/pull-calendar";
import { diffEvents, parseIcsEvents } from "@keeper.sh/sync-events";
import { parseIcsCalendar } from "@keeper.sh/calendar";
import { desc, eq, inArray } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const FIRST_RESULT_LIMIT = 1;
const EMPTY_EVENTS_COUNT = 0;

class RemoteCalendarSyncError extends Error {
  constructor(
    public sourceId: string,
    cause: unknown,
  ) {
    super(`Failed to sync remote calendar ${sourceId}`);
    this.cause = cause;
  }
}

type Source = typeof remoteICalSourcesTable.$inferSelect;

interface SyncCalendarService {
  createSnapshot: (sourceId: string, ical: string) => Promise<void>;
  syncSourceFromSnapshot: (source: Source) => Promise<void>;
  fetchAndSyncSource: (source: Source) => Promise<void>;
}

const toStoredEvent = (row: {
  id: string;
  sourceEventUid: string;
  startTime: Date;
  endTime: Date;
}): { endTime: Date; id: string; startTime: Date; uid: string } => ({
  endTime: row.endTime,
  id: row.id,
  startTime: row.startTime,
  uid: row.sourceEventUid,
});

const createSyncCalendarService = (database: BunSQLDatabase): SyncCalendarService => {
  const getLatestSnapshot = async (
    sourceId: string,
  ): Promise<ReturnType<typeof parseIcsCalendar> | null> => {
    const [snapshot] = await database
      .select({ ical: calendarSnapshotsTable.ical })
      .from(calendarSnapshotsTable)
      .where(eq(calendarSnapshotsTable.sourceId, sourceId))
      .orderBy(desc(calendarSnapshotsTable.createdAt))
      .limit(FIRST_RESULT_LIMIT);

    if (!snapshot?.ical) {
      return null;
    }
    return parseIcsCalendar({ icsString: snapshot.ical });
  };

  const getStoredEvents = async (
    sourceId: string,
  ): Promise<{ endTime: Date; id: string; startTime: Date; uid: string }[]> => {
    const results = await database
      .select({
        endTime: eventStatesTable.endTime,
        id: eventStatesTable.id,
        sourceEventUid: eventStatesTable.sourceEventUid,
        startTime: eventStatesTable.startTime,
      })
      .from(eventStatesTable)
      .where(eq(eventStatesTable.sourceId, sourceId));

    const events = [];
    for (const row of results) {
      if (row.sourceEventUid === null) {
        continue;
      }
      events.push(toStoredEvent({ ...row, sourceEventUid: row.sourceEventUid }));
    }

    return events;
  };

  const removeEvents = async (_sourceId: string, eventIds: string[]): Promise<void> => {
    await database.delete(eventStatesTable).where(inArray(eventStatesTable.id, eventIds));
  };

  const addEvents = async (
    sourceId: string,
    events: { uid: string; startTime: Date; endTime: Date }[],
  ): Promise<void> => {
    const rows = events.map((event) => ({
      endTime: event.endTime,
      sourceEventUid: event.uid,
      sourceId,
      startTime: event.startTime,
    }));

    await database.insert(eventStatesTable).values(rows);
  };

  const createSnapshot = async (sourceId: string, ical: string): Promise<void> => {
    await database.insert(calendarSnapshotsTable).values({ ical, sourceId });
  };

  const syncSourceFromSnapshot = async (source: Source): Promise<void> => {
    const icsCalendar = await getLatestSnapshot(source.id);
    if (!icsCalendar) {
      return;
    }

    const remoteEvents = parseIcsEvents(icsCalendar);
    const storedEvents = await getStoredEvents(source.id);
    const { toAdd, toRemove } = diffEvents(remoteEvents, storedEvents);

    if (toRemove.length > EMPTY_EVENTS_COUNT) {
      const eventIds = toRemove.map((event) => event.id);
      await removeEvents(source.id, eventIds);
    }

    if (toAdd.length > EMPTY_EVENTS_COUNT) {
      await addEvents(source.id, toAdd);
    }
  };

  const fetchAndSyncSource = async (source: Source): Promise<void> => {
    const { ical } = await pullRemoteCalendar("ical", source.url);
    await createSnapshot(source.id, ical);
    await syncSourceFromSnapshot(source);
  };

  return { createSnapshot, fetchAndSyncSource, syncSourceFromSnapshot };
};

export { RemoteCalendarSyncError, createSyncCalendarService };
export type { Source, SyncCalendarService };
