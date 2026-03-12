import {
  calendarAccountsTable,
  calendarsTable,
  eventStatesTable,
  sourceDestinationMappingsTable,
  syncStatusTable,
} from "@keeper.sh/database/schema";
import { normalizeDateRange } from "@keeper.sh/date-utils";
import { and, arrayContains, asc, count, eq, gte, inArray, lte } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { withAccountDisplay } from "./provider-display";

const EMPTY_RESULT_COUNT = 0;

type KeeperDatabase = BunSQLDatabase;

interface KeeperEventRangeInput {
  from: Date | string;
  to: Date | string;
}

interface KeeperSource {
  id: string;
  name: string;
  calendarType: string;
  capabilities: string[];
  accountId: string;
  provider: string;
  displayName: string | null;
  email: string | null;
  accountIdentifier: string | null;
  needsReauthentication: boolean;
  includeInIcalFeed: boolean;
  providerName: string;
  providerIcon: string | null;
  accountLabel: string;
}

interface KeeperDestination {
  id: string;
  provider: string;
  email: string | null;
  needsReauthentication: boolean;
}

interface KeeperMapping {
  id: string;
  sourceCalendarId: string;
  destinationCalendarId: string;
  createdAt: string;
  calendarType: string;
}

interface KeeperEvent {
  id: string;
  startTime: string;
  endTime: string;
  title: string | null;
  description: string | null;
  location: string | null;
  calendarId: string;
  calendarName: string | null;
  calendarProvider: string | null;
  calendarUrl: string | null;
}

interface KeeperSyncStatus {
  calendarId: string;
  inSync: boolean;
  lastSyncedAt: string | null;
  localEventCount: number;
  remoteEventCount: number;
}

interface KeeperApi {
  listSources: (userId: string) => Promise<KeeperSource[]>;
  listDestinations: (userId: string) => Promise<KeeperDestination[]>;
  listMappings: (userId: string) => Promise<KeeperMapping[]>;
  getEventsInRange: (userId: string, range: KeeperEventRangeInput) => Promise<KeeperEvent[]>;
  getEventCount: (userId: string) => Promise<number>;
  getSyncStatuses: (userId: string) => Promise<KeeperSyncStatus[]>;
}

const toIsoString = (value: Date | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  return value.toISOString();
};

const toRequiredDate = (value: Date | string, label: "from" | "to"): Date => {
  const parsedDate = value instanceof Date ? new Date(value) : new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    throw new Error(`Invalid ${label} date`);
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

const createKeeperApi = (database: KeeperDatabase): KeeperApi => ({
  listSources: async (userId) => {
    const calendars = await database
      .select({
        id: calendarsTable.id,
        name: calendarsTable.name,
        calendarType: calendarsTable.calendarType,
        capabilities: calendarsTable.capabilities,
        accountId: calendarAccountsTable.id,
        provider: calendarAccountsTable.provider,
        displayName: calendarAccountsTable.displayName,
        email: calendarAccountsTable.email,
        accountIdentifier: calendarAccountsTable.accountId,
        needsReauthentication: calendarAccountsTable.needsReauthentication,
        includeInIcalFeed: calendarsTable.includeInIcalFeed,
      })
      .from(calendarsTable)
      .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
      .where(eq(calendarsTable.userId, userId))
      .orderBy(asc(calendarsTable.createdAt));

    return calendars.map((calendar) => withAccountDisplay(calendar));
  },
  listDestinations: async (userId) => {
    const accounts = await database
      .select({
        email: calendarAccountsTable.email,
        id: calendarAccountsTable.id,
        needsReauthentication: calendarAccountsTable.needsReauthentication,
        provider: calendarAccountsTable.provider,
      })
      .from(calendarAccountsTable)
      .innerJoin(calendarsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
      .where(
        and(
          eq(calendarAccountsTable.userId, userId),
          inArray(
            calendarsTable.id,
            database
              .selectDistinct({ id: sourceDestinationMappingsTable.destinationCalendarId })
              .from(sourceDestinationMappingsTable),
          ),
        ),
      );

    return accounts;
  },
  listMappings: async (userId) => {
    const userSourceCalendars = await database
      .select({
        calendarType: calendarsTable.calendarType,
        id: calendarsTable.id,
      })
      .from(calendarsTable)
      .where(
        and(
          eq(calendarsTable.userId, userId),
          inArray(
            calendarsTable.id,
            database
              .selectDistinct({ id: sourceDestinationMappingsTable.sourceCalendarId })
              .from(sourceDestinationMappingsTable),
          ),
        ),
      );

    if (userSourceCalendars.length === EMPTY_RESULT_COUNT) {
      return [];
    }

    const calendarIds = userSourceCalendars.map((calendar) => calendar.id);
    const typeByCalendarId = new Map(
      userSourceCalendars.map((calendar) => [calendar.id, calendar.calendarType]),
    );

    const mappings = await database
      .select()
      .from(sourceDestinationMappingsTable)
      .where(inArray(sourceDestinationMappingsTable.sourceCalendarId, calendarIds));

    return mappings.map((mapping) => ({
      ...mapping,
      calendarType: typeByCalendarId.get(mapping.sourceCalendarId) ?? "unknown",
      createdAt: mapping.createdAt.toISOString(),
    }));
  },
  getEventsInRange: async (userId, range) => {
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

      return {
        calendarId: event.calendarId,
        calendarName: source?.name ?? null,
        calendarProvider: source?.provider ?? null,
        calendarUrl: source?.url ?? null,
        description: event.description,
        endTime: event.endTime.toISOString(),
        id: event.id,
        location: event.location,
        startTime: event.startTime.toISOString(),
        title: event.title,
      };
    });
  },
  getEventCount: async (userId) => {
    const sources = await database
      .select({ id: calendarsTable.id })
      .from(calendarsTable)
      .where(
        and(
          eq(calendarsTable.userId, userId),
          arrayContains(calendarsTable.capabilities, ["pull"]),
        ),
      );

    if (sources.length === EMPTY_RESULT_COUNT) {
      return 0;
    }

    const calendarIds = sources.map((source) => source.id);

    const [result] = await database
      .select({ count: count() })
      .from(eventStatesTable)
      .where(inArray(eventStatesTable.calendarId, calendarIds));

    return result?.count ?? 0;
  },
  getSyncStatuses: async (userId) => {
    const statuses = await database
      .select({
        calendarId: syncStatusTable.calendarId,
        lastSyncedAt: syncStatusTable.lastSyncedAt,
        localEventCount: syncStatusTable.localEventCount,
        remoteEventCount: syncStatusTable.remoteEventCount,
      })
      .from(syncStatusTable)
      .innerJoin(calendarsTable, eq(syncStatusTable.calendarId, calendarsTable.id))
      .where(
        and(
          eq(calendarsTable.userId, userId),
          inArray(
            calendarsTable.id,
            database
              .selectDistinct({ id: sourceDestinationMappingsTable.destinationCalendarId })
              .from(sourceDestinationMappingsTable),
          ),
        ),
      );

    return statuses.map((status) => ({
      calendarId: status.calendarId,
      inSync: status.localEventCount === status.remoteEventCount,
      lastSyncedAt: toIsoString(status.lastSyncedAt),
      localEventCount: status.localEventCount,
      remoteEventCount: status.remoteEventCount,
    }));
  },
});

export { createKeeperApi, normalizeEventRange };
export type {
  KeeperApi,
  KeeperDestination,
  KeeperEvent,
  KeeperEventRangeInput,
  KeeperMapping,
  KeeperSource,
  KeeperSyncStatus,
};
