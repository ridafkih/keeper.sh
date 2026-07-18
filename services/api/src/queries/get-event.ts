import {
  calendarAccountsTable,
  calendarsTable,
  eventStatesTable,
  userEventsTable,
} from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";

import type { KeeperDatabase, KeeperEvent } from "@/types";
import {
  parseEventReference,
  projectSyncedEvents,
  toKeeperEvent,
} from "./event-read-model";
import type {
  KeeperEventProjection,
  SourceInfo,
  SyncedEventRow,
} from "./event-read-model";

interface SyncedEventOwner extends SyncedEventRow {
  calendarName: string;
  calendarProvider: string;
  calendarUrl: string | null;
}

interface EventReadRepository {
  getSeriesRows: (owner: SyncedEventOwner) => Promise<SyncedEventRow[]>;
  getSyncedOwner: (userId: string, resourceId: string) => Promise<SyncedEventOwner | null>;
  getUserEvent: (userId: string, resourceId: string) => Promise<KeeperEvent | null>;
}

const syncedEventColumns = {
  availability: eventStatesTable.availability,
  calendarId: eventStatesTable.calendarId,
  description: eventStatesTable.description,
  endTime: eventStatesTable.endTime,
  exceptionDates: eventStatesTable.exceptionDates,
  id: eventStatesTable.id,
  isAllDay: eventStatesTable.isAllDay,
  location: eventStatesTable.location,
  recurrenceId: eventStatesTable.recurrenceId,
  recurrenceRule: eventStatesTable.recurrenceRule,
  sourceEventUid: eventStatesTable.sourceEventUid,
  startTime: eventStatesTable.startTime,
  startTimeZone: eventStatesTable.startTimeZone,
  title: eventStatesTable.title,
};

const getUserEvent = async (
  database: KeeperDatabase,
  userId: string,
  resourceId: string,
): Promise<KeeperEvent | null> => {
  const [result] = await database
    .select({
      id: userEventsTable.id,
      calendarId: userEventsTable.calendarId,
      startTime: userEventsTable.startTime,
      endTime: userEventsTable.endTime,
      title: userEventsTable.title,
      description: userEventsTable.description,
      location: userEventsTable.location,
      calendarName: calendarsTable.name,
      calendarProvider: calendarAccountsTable.provider,
      calendarUrl: calendarsTable.url,
    })
    .from(userEventsTable)
    .innerJoin(calendarsTable, eq(userEventsTable.calendarId, calendarsTable.id))
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .where(
      and(
        eq(userEventsTable.id, resourceId),
        eq(userEventsTable.userId, userId),
      ),
    )
    .limit(1);

  if (!result) {
    return null;
  }

  return toKeeperEvent(
    { ...result, eventStateId: null },
    {
      name: result.calendarName,
      provider: result.calendarProvider,
      url: result.calendarUrl,
      userId,
    },
  );
};

const getSyncedOwner = async (
  database: KeeperDatabase,
  userId: string,
  resourceId: string,
): Promise<SyncedEventOwner | null> => {
  const [owner] = await database
    .select({
      ...syncedEventColumns,
      calendarName: calendarsTable.name,
      calendarProvider: calendarAccountsTable.provider,
      calendarUrl: calendarsTable.url,
    })
    .from(eventStatesTable)
    .innerJoin(calendarsTable, eq(eventStatesTable.calendarId, calendarsTable.id))
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .where(
      and(
        eq(eventStatesTable.id, resourceId),
        eq(calendarsTable.userId, userId),
      ),
    )
    .limit(1);

  return owner ?? null;
};

const getSeriesRows = (
  database: KeeperDatabase,
  owner: SyncedEventOwner,
): Promise<SyncedEventRow[]> => {
  if (!owner.sourceEventUid) {
    return Promise.resolve([owner]);
  }
  return database
    .select(syncedEventColumns)
    .from(eventStatesTable)
    .where(
      and(
        eq(eventStatesTable.calendarId, owner.calendarId),
        eq(eventStatesTable.sourceEventUid, owner.sourceEventUid),
      ),
    );
};

const toPersistedSyncedProjection = (row: SyncedEventRow): KeeperEventProjection => ({
  calendarId: row.calendarId,
  description: row.description,
  endTime: row.endTime,
  eventStateId: row.id,
  id: row.id,
  location: row.location,
  startTime: row.startTime,
  title: row.title,
});

const resolveEventReadModel = async (
  repository: EventReadRepository,
  userId: string,
  eventId: string,
): Promise<KeeperEvent | null> => {
  const reference = parseEventReference(eventId);
  if (!reference) {
    return null;
  }

  if (!reference.occurrenceStart) {
    const userEvent = await repository.getUserEvent(userId, reference.resourceId);
    if (userEvent) {
      return userEvent;
    }
  }

  const owner = await repository.getSyncedOwner(userId, reference.resourceId);

  if (!owner) {
    return null;
  }

  const source: SourceInfo = {
    name: owner.calendarName,
    provider: owner.calendarProvider,
    url: owner.calendarUrl,
    userId,
  };

  if (!reference.occurrenceStart) {
    return toKeeperEvent(toPersistedSyncedProjection(owner), source);
  }
  if (!owner.recurrenceRule) {
    return null;
  }

  const seriesRows = await repository.getSeriesRows(owner);
  const sourceMap = new Map([[owner.calendarId, source]]);
  const projectedEvents = projectSyncedEvents(
    seriesRows,
    sourceMap,
    reference.occurrenceStart,
    reference.occurrenceStart,
  );
  const occurrence = projectedEvents.find((event) => event.id === eventId);

  if (!occurrence) {
    return null;
  }
  return toKeeperEvent(occurrence, source);
};

const getEvent = (
  database: KeeperDatabase,
  userId: string,
  eventId: string,
): Promise<KeeperEvent | null> => resolveEventReadModel(
  {
    getSeriesRows: (owner) => getSeriesRows(database, owner),
    getSyncedOwner: (requestedUserId, resourceId) =>
      getSyncedOwner(database, requestedUserId, resourceId),
    getUserEvent: (requestedUserId, resourceId) =>
      getUserEvent(database, requestedUserId, resourceId),
  },
  userId,
  eventId,
);

export { getEvent, resolveEventReadModel };
export type { EventReadRepository, SyncedEventOwner };
