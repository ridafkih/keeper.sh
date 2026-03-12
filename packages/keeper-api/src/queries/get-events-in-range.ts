import {
  calendarAccountsTable,
  calendarsTable,
  eventStatesTable,
} from "@keeper.sh/database/schema";
import { normalizeDateRange } from "@keeper.sh/date-utils";
import { and, arrayContains, asc, eq, gte, inArray, lte } from "drizzle-orm";
import type { KeeperDatabase, KeeperEvent, KeeperEventRangeInput } from "../types";

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

const getEventsInRange = async (
  database: KeeperDatabase,
  userId: string,
  range: KeeperEventRangeInput,
): Promise<KeeperEvent[]> => {
  const { start, end } = normalizeEventRange(range);

  const sources = await database
    .select({
      id: calendarsTable.id,
      name: calendarsTable.name,
      provider: calendarAccountsTable.provider,
      url: calendarsTable.url,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .where(
      and(
        eq(calendarsTable.userId, userId),
        arrayContains(calendarsTable.capabilities, ["pull"]),
      ),
    );

  if (sources.length === EMPTY_RESULT_COUNT) {
    return [];
  }

  const calendarIds = sources.map((source) => source.id);
  const sourceMap = new Map(
    sources.map((source) => [
      source.id,
      {
        name: source.name,
        provider: source.provider,
        url: source.url,
      },
    ]),
  );

  const events = await database
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
    .where(
      and(
        inArray(eventStatesTable.calendarId, calendarIds),
        gte(eventStatesTable.startTime, start),
        lte(eventStatesTable.startTime, end),
      ),
    )
    .orderBy(asc(eventStatesTable.startTime));

  return events.map((event) => {
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
