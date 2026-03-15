import {
  calendarAccountsTable,
  calendarsTable,
  eventStatesTable,
  userEventsTable,
} from "@keeper.sh/database/schema";
import { normalizeDateRange } from "@keeper.sh/date-utils";
import { and, arrayContains, asc, eq, gte, inArray, lte } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { KeeperDatabase, KeeperEvent, KeeperEventFilters, KeeperEventRangeInput } from "../types";

const EMPTY_RESULT_COUNT = 0;

const toRequiredDate = (value: Date | string, label: "from" | "to"): Date => {
  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    throw new TypeError(`Invalid ${label} date`);
  }

  return parsedDate;
};

const normalizeEventRange = (
  range: KeeperEventRangeInput,
): {
  start: Date;
  end: Date;
} => normalizeDateRange(
  toRequiredDate(range.from, "from"),
  toRequiredDate(range.to, "to"),
);

interface SourceInfo {
  name: string;
  provider: string;
  url: string | null;
  userId: string;
}

const getSourcesForUser = async (
  database: KeeperDatabase,
  userId: string,
  filters?: KeeperEventFilters,
): Promise<{ calendarIds: string[]; sourceMap: Map<string, SourceInfo> }> => {
  const sourceConditions: SQL[] = [
    eq(calendarsTable.userId, userId),
    arrayContains(calendarsTable.capabilities, ["pull"]),
  ];

  if (filters?.calendarId && filters.calendarId.length > 0) {
    sourceConditions.push(inArray(calendarsTable.id, filters.calendarId));
  }

  const sources = await database
    .select({
      id: calendarsTable.id,
      name: calendarsTable.name,
      provider: calendarAccountsTable.provider,
      url: calendarsTable.url,
      userId: calendarsTable.userId,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .where(and(...sourceConditions));

  const calendarIds = sources.map((source) => source.id);
  const sourceMap = new Map(
    sources.map((source) => [
      source.id,
      { name: source.name, provider: source.provider, url: source.url, userId: source.userId },
    ]),
  );

  return { calendarIds, sourceMap };
};

const getEventsInRange = async (
  database: KeeperDatabase,
  userId: string,
  range: KeeperEventRangeInput,
  filters?: KeeperEventFilters,
): Promise<KeeperEvent[]> => {
  const { start, end } = normalizeEventRange(range);
  const { calendarIds, sourceMap } = await getSourcesForUser(database, userId, filters);

  if (calendarIds.length === EMPTY_RESULT_COUNT) {
    return [];
  }

  const syncedConditions: SQL[] = [
    inArray(eventStatesTable.calendarId, calendarIds),
    gte(eventStatesTable.startTime, start),
    lte(eventStatesTable.startTime, end),
  ];

  if (filters?.availability && filters.availability.length > 0) {
    syncedConditions.push(inArray(eventStatesTable.availability, filters.availability));
  }

  if (filters && "isAllDay" in filters && typeof filters.isAllDay === "boolean") {
    syncedConditions.push(eq(eventStatesTable.isAllDay, filters.isAllDay));
  }

  const syncedEvents = await database
    .select({
      calendarId: eventStatesTable.calendarId,
      description: eventStatesTable.description,
      endTime: eventStatesTable.endTime,
      id: eventStatesTable.id,
      location: eventStatesTable.location,
      startTime: eventStatesTable.startTime,
      title: eventStatesTable.title,
    })
    .from(eventStatesTable)
    .where(and(...syncedConditions))
    .orderBy(asc(eventStatesTable.startTime));

  const userConditions: SQL[] = [
    inArray(userEventsTable.calendarId, calendarIds),
    eq(userEventsTable.userId, userId),
    gte(userEventsTable.startTime, start),
    lte(userEventsTable.startTime, end),
  ];

  if (filters?.availability && filters.availability.length > 0) {
    userConditions.push(inArray(userEventsTable.availability, filters.availability));
  }

  if (filters && "isAllDay" in filters && typeof filters.isAllDay === "boolean") {
    userConditions.push(eq(userEventsTable.isAllDay, filters.isAllDay));
  }

  const userEvents = await database
    .select({
      calendarId: userEventsTable.calendarId,
      description: userEventsTable.description,
      endTime: userEventsTable.endTime,
      id: userEventsTable.id,
      location: userEventsTable.location,
      startTime: userEventsTable.startTime,
      title: userEventsTable.title,
    })
    .from(userEventsTable)
    .where(and(...userConditions))
    .orderBy(asc(userEventsTable.startTime));

  const allEvents = [...syncedEvents, ...userEvents];
  allEvents.sort((left, right) => left.startTime.getTime() - right.startTime.getTime());

  return allEvents.map((event) => {
    const source = sourceMap.get(event.calendarId);

    if (!source) {
      throw new Error(`No source calendar found for event calendar ID: ${event.calendarId}`);
    }

    return {
      calendarId: event.calendarId,
      calendarName: source.name,
      calendarProvider: source.provider,
      calendarUrl: source.url,
      description: event.description,
      endTime: event.endTime.toISOString(),
      id: event.id,
      location: event.location,
      startTime: event.startTime.toISOString(),
      title: event.title,
    };
  });
};

export { getEventsInRange, normalizeEventRange };
