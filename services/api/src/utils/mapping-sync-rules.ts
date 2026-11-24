import {
  calendarAccountsTable,
  calendarsTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { resolveSyncRules } from "@keeper.sh/data-schemas";
import type { SyncRuleOverrides, SyncRules } from "@keeper.sh/data-schemas";
import { and, eq, isNotNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { database as databaseInstance } from "@/context";
import { requestUserSync } from "./source-destination-mappings";

type DatabaseClient = typeof databaseInstance;
type DatabaseTransactionCallback = Parameters<DatabaseClient["transaction"]>[0];
type DatabaseTransactionClient = Parameters<DatabaseTransactionCallback>[0];
type DatabaseReader = Pick<DatabaseClient | DatabaseTransactionClient, "select">;
type TransactionalDatabase = Pick<DatabaseClient, "transaction">;

interface MappingSyncRules {
  sourceCalendarId: string;
  destinationCalendarId: string;
  sourceProvider: string;
  includeUpstreamSources: boolean;
  overrides: SyncRuleOverrides;
  sourceRules: SyncRules;
  effectiveRules: SyncRules;
}

type SyncRuleOverrideUpdates = Partial<SyncRuleOverrides>;

interface MappingSyncRuleUpdates extends SyncRuleOverrideUpdates {
  includeUpstreamSources?: boolean;
}

type CountEffectiveMappings = (
  client: DatabaseReader,
  userId: string,
) => Promise<number>;

interface MappingLimitGuard {
  countEffectiveMappings: CountEffectiveMappings;
  limitErrorMessage: string;
  mappingLimit: number;
}

const destinationCalendarsTable = alias(calendarsTable, "destination_calendars");

const OVERRIDE_COLUMNS = {
  customEventName: sourceDestinationMappingsTable.customEventName,
  disableEventReminders: sourceDestinationMappingsTable.disableEventReminders,
  excludeAllDayEvents: sourceDestinationMappingsTable.excludeAllDayEvents,
  excludeAvailabilities: sourceDestinationMappingsTable.excludeAvailabilities,
  excludeEventDescription: sourceDestinationMappingsTable.excludeEventDescription,
  excludeEventLocation: sourceDestinationMappingsTable.excludeEventLocation,
  excludeEventMeetingLink: sourceDestinationMappingsTable.excludeEventMeetingLink,
  excludeEventName: sourceDestinationMappingsTable.excludeEventName,
  excludeFocusTime: sourceDestinationMappingsTable.excludeFocusTime,
  excludeOutOfOffice: sourceDestinationMappingsTable.excludeOutOfOffice,
  excludeTitleKeywords: sourceDestinationMappingsTable.excludeTitleKeywords,
  markEventsAsPrivate: sourceDestinationMappingsTable.markEventsAsPrivate,
} as const;

const SOURCE_RULE_COLUMNS = {
  customEventName: calendarsTable.customEventName,
  disableEventReminders: calendarsTable.disableEventReminders,
  excludeAllDayEvents: calendarsTable.excludeAllDayEvents,
  excludeAvailabilities: calendarsTable.excludeAvailabilities,
  excludeEventDescription: calendarsTable.excludeEventDescription,
  excludeEventLocation: calendarsTable.excludeEventLocation,
  excludeEventMeetingLink: calendarsTable.excludeEventMeetingLink,
  excludeEventName: calendarsTable.excludeEventName,
  excludeFocusTime: calendarsTable.excludeFocusTime,
  excludeOutOfOffice: calendarsTable.excludeOutOfOffice,
  excludeTitleKeywords: calendarsTable.excludeTitleKeywords,
  markEventsAsPrivate: calendarsTable.markEventsAsPrivate,
} as const;

const ownedMappingCondition = (
  userId: string,
  sourceCalendarId: string,
  destinationCalendarId: string,
) =>
  and(
    eq(sourceDestinationMappingsTable.sourceCalendarId, sourceCalendarId),
    eq(sourceDestinationMappingsTable.destinationCalendarId, destinationCalendarId),
    eq(calendarsTable.userId, userId),
    eq(destinationCalendarsTable.userId, userId),
  );

const readMappingSyncRules = async (
  client: DatabaseReader,
  userId: string,
  sourceCalendarId: string,
  destinationCalendarId: string,
): Promise<MappingSyncRules | null> => {
  const [mapping] = await client
    .select({
      includeUpstreamSources: sourceDestinationMappingsTable.includeUpstreamSources,
      overrides: OVERRIDE_COLUMNS,
      sourceProvider: calendarAccountsTable.provider,
      sourceRules: SOURCE_RULE_COLUMNS,
    })
    .from(sourceDestinationMappingsTable)
    .innerJoin(
      calendarsTable,
      eq(sourceDestinationMappingsTable.sourceCalendarId, calendarsTable.id),
    )
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .innerJoin(
      destinationCalendarsTable,
      eq(sourceDestinationMappingsTable.destinationCalendarId, destinationCalendarsTable.id),
    )
    .where(ownedMappingCondition(userId, sourceCalendarId, destinationCalendarId))
    .limit(1);

  if (!mapping) {
    return null;
  }

  return {
    destinationCalendarId,
    effectiveRules: resolveSyncRules(mapping.sourceRules, mapping.overrides),
    includeUpstreamSources: mapping.includeUpstreamSources,
    overrides: mapping.overrides,
    sourceCalendarId,
    sourceProvider: mapping.sourceProvider,
    sourceRules: mapping.sourceRules,
  };
};

const writeMappingSyncRuleOverrides = (
  database: TransactionalDatabase,
  userId: string,
  sourceCalendarId: string,
  destinationCalendarId: string,
  updates: MappingSyncRuleUpdates,
  limitGuard?: MappingLimitGuard,
): Promise<MappingSyncRules | null> =>
  database.transaction(async (transaction) => {
    const existing = await readMappingSyncRules(
      transaction,
      userId,
      sourceCalendarId,
      destinationCalendarId,
    );
    if (!existing) {
      return null;
    }

    await transaction
      .update(sourceDestinationMappingsTable)
      .set(updates)
      .where(
        and(
          eq(sourceDestinationMappingsTable.sourceCalendarId, sourceCalendarId),
          eq(sourceDestinationMappingsTable.destinationCalendarId, destinationCalendarId),
        ),
      );
    if (
      limitGuard
      && updates.includeUpstreamSources === true
      && !existing.includeUpstreamSources
      && await limitGuard.countEffectiveMappings(transaction, userId) > limitGuard.mappingLimit
    ) {
      throw new Error(limitGuard.limitErrorMessage);
    }
    await requestUserSync(transaction, userId);

    return readMappingSyncRules(transaction, userId, sourceCalendarId, destinationCalendarId);
  });

const readCustomizedDestinationIds = async (
  client: DatabaseReader,
  userId: string,
  sourceCalendarId: string,
): Promise<string[]> => {
  const mappings = await client
    .select({ destinationCalendarId: sourceDestinationMappingsTable.destinationCalendarId })
    .from(sourceDestinationMappingsTable)
    .innerJoin(
      calendarsTable,
      eq(sourceDestinationMappingsTable.sourceCalendarId, calendarsTable.id),
    )
    .where(
      and(
        eq(sourceDestinationMappingsTable.sourceCalendarId, sourceCalendarId),
        eq(calendarsTable.userId, userId),
        or(...Object.values(OVERRIDE_COLUMNS).map((column) => isNotNull(column))),
      ),
    );

  return mappings.map((mapping) => mapping.destinationCalendarId);
};

export {
  readCustomizedDestinationIds,
  readMappingSyncRules,
  writeMappingSyncRuleOverrides,
};
export type {
  MappingLimitGuard,
  MappingSyncRules,
  MappingSyncRuleUpdates,
  SyncRuleOverrideUpdates,
};
