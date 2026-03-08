import type { calendarsTable } from "@keeper.sh/database/schema";
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
    public calendarId: string,
    cause: unknown,
  ) {
    super(`Failed to sync remote calendar ${calendarId}`);
    this.cause = cause;
  }
}

type Source = typeof calendarsTable.$inferSelect;

interface SyncCalendarService {
  createSnapshot: (calendarId: string, ical: string) => Promise<void>;
  syncSourceFromSnapshot: (source: Source) => Promise<void>;
  fetchAndSyncSource: (source: Source) => Promise<void>;
}

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

const toStoredEvent = (row: {
  id: string;
  sourceEventUid: string;
  startTime: Date;
  endTime: Date;
  startTimeZone: string | null;
  recurrenceRule: string | null;
  exceptionDates: string | null;
}): {
  endTime: Date;
  id: string;
  startTime: Date;
  startTimeZone?: string;
  uid: string;
  recurrenceRule?: object;
  exceptionDates?: object;
} => {
  const storedEvent: {
    endTime: Date;
    id: string;
    startTime: Date;
    startTimeZone?: string;
    uid: string;
    recurrenceRule?: object;
    exceptionDates?: object;
  } = {
    endTime: row.endTime,
    id: row.id,
    startTime: row.startTime,
    uid: row.sourceEventUid,
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

const createSyncCalendarService = (database: BunSQLDatabase): SyncCalendarService => {
  const getLatestSnapshot = async (
    calendarId: string,
  ): Promise<ReturnType<typeof parseIcsCalendar> | null> => {
    const [snapshot] = await database
      .select({ ical: calendarSnapshotsTable.ical })
      .from(calendarSnapshotsTable)
      .where(eq(calendarSnapshotsTable.calendarId, calendarId))
      .orderBy(desc(calendarSnapshotsTable.createdAt))
      .limit(FIRST_RESULT_LIMIT);

    if (!snapshot?.ical) {
      return null;
    }
    return parseIcsCalendar({ icsString: snapshot.ical });
  };

  const getStoredEvents = async (
    calendarId: string,
  ): Promise<{ endTime: Date; id: string; startTime: Date; startTimeZone?: string; uid: string }[]> => {
    const results = await database
      .select({
        endTime: eventStatesTable.endTime,
        exceptionDates: eventStatesTable.exceptionDates,
        id: eventStatesTable.id,
        recurrenceRule: eventStatesTable.recurrenceRule,
        sourceEventUid: eventStatesTable.sourceEventUid,
        startTime: eventStatesTable.startTime,
        startTimeZone: eventStatesTable.startTimeZone,
      })
      .from(eventStatesTable)
      .where(eq(eventStatesTable.calendarId, calendarId));

    const events = [];
    for (const row of results) {
      if (row.sourceEventUid === null) {
        continue;
      }
      events.push(toStoredEvent({ ...row, sourceEventUid: row.sourceEventUid }));
    }

    return events;
  };

  const removeEvents = async (_calendarId: string, eventIds: string[]): Promise<void> => {
    await database.delete(eventStatesTable).where(inArray(eventStatesTable.id, eventIds));
  };

  const addEvents = async (
    calendarId: string,
    events: {
      uid: string;
      startTime: Date;
      endTime: Date;
      startTimeZone?: string;
      recurrenceRule?: object;
      exceptionDates?: object;
    }[],
  ): Promise<void> => {
    const rows = events.map((event) => ({
      endTime: event.endTime,
      exceptionDates: event.exceptionDates ? JSON.stringify(event.exceptionDates) : undefined,
      sourceEventUid: event.uid,
      calendarId,
      recurrenceRule: event.recurrenceRule ? JSON.stringify(event.recurrenceRule) : undefined,
      startTime: event.startTime,
      startTimeZone: event.startTimeZone,
    }));

    await database.insert(eventStatesTable).values(rows);
  };

  const createSnapshot = async (calendarId: string, ical: string): Promise<void> => {
    await database.insert(calendarSnapshotsTable).values({ ical, calendarId });
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
    if (!source.url) {
      throw new Error(`Source ${source.id} is missing url`);
    }
    const { ical } = await pullRemoteCalendar("ical", source.url);
    await createSnapshot(source.id, ical);
    await syncSourceFromSnapshot(source);
  };

  return { createSnapshot, fetchAndSyncSource, syncSourceFromSnapshot };
};

export { RemoteCalendarSyncError, createSyncCalendarService };
export type { Source, SyncCalendarService };
