import { applySourceSyncDefaults } from "@keeper.sh/data-schemas";
import {
  calendarAccountsTable,
  calendarRemovalsTable,
  calendarsTable,
} from "@keeper.sh/database/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { BunSQLTransactionClient } from "../database-client";
import { resolveCalendarCapabilities } from "./calendar-capabilities";
import { findUserCalDAVCalendarsOnServer } from "./user-caldav-calendars";
import {
  planCalendarRediscovery,
  toExistingCalendars,
  toRemovedIdentityKeys,
} from "./calendar-rediscovery";
import type {
  CalendarRediscoveryPlan,
  DiscoveredCalendar,
  RediscoveryCalendarType,
} from "./calendar-rediscovery";

const USER_ACCOUNT_LOCK_NAMESPACE = 9002;

interface InsertedCalendar {
  id: string;
  name: string;
}

interface CalendarRediscoveryApplyResult extends CalendarRediscoveryPlan {
  inserted: InsertedCalendar[];
}

interface CalendarRediscoveryApplyInput {
  accountId: string;
  userId: string;
  calendarType: RediscoveryCalendarType;
  caldavServerHost: string | null;
  discovered: DiscoveredCalendar[];
  now: Date;
}

const readExistingCalendars = async (
  transaction: BunSQLTransactionClient,
  input: CalendarRediscoveryApplyInput,
) => {
  const rows = await transaction
    .select({
      calendarUrl: calendarsTable.calendarUrl,
      capabilities: calendarsTable.capabilities,
      createdAt: calendarsTable.createdAt,
      externalCalendarId: calendarsTable.externalCalendarId,
      id: calendarsTable.id,
      unavailableSince: calendarsTable.unavailableSince,
    })
    .from(calendarsTable)
    .where(and(
      eq(calendarsTable.accountId, input.accountId),
      eq(calendarsTable.userId, input.userId),
      eq(calendarsTable.calendarType, input.calendarType),
    ));

  return toExistingCalendars(rows, input.calendarType);
};

const readRemovedKeys = async (
  transaction: BunSQLTransactionClient,
  input: CalendarRediscoveryApplyInput,
): Promise<Set<string>> => {
  const rows = await transaction
    .select({
      calendarUrl: calendarRemovalsTable.calendarUrl,
      externalCalendarId: calendarRemovalsTable.externalCalendarId,
      id: calendarRemovalsTable.id,
    })
    .from(calendarRemovalsTable)
    .where(and(
      eq(calendarRemovalsTable.accountId, input.accountId),
      eq(calendarRemovalsTable.userId, input.userId),
      eq(calendarRemovalsTable.calendarType, input.calendarType),
    ));

  return toRemovedIdentityKeys(rows, input.calendarType);
};

const readCrossAccountCalDAVKeys = async (
  transaction: BunSQLTransactionClient,
  input: CalendarRediscoveryApplyInput,
): Promise<Set<string>> => {
  const { caldavServerHost } = input;
  if (!caldavServerHost) {
    return new Set<string>();
  }

  const calendars = await findUserCalDAVCalendarsOnServer(transaction, {
    caldavServerHost,
    excludeAccountId: input.accountId,
    userId: input.userId,
  });

  return new Set(calendars.map(({ identityKey }) => identityKey));
};

const resolveIdentityColumn = (
  calendar: DiscoveredCalendar,
): { calendarUrl: string | null } | { externalCalendarId: string } => {
  if (calendar.externalCalendarId === null) {
    return { calendarUrl: calendar.calendarUrl };
  }
  return { externalCalendarId: calendar.externalCalendarId };
};

const buildInsertRow = (
  calendar: DiscoveredCalendar,
  input: CalendarRediscoveryApplyInput,
) => applySourceSyncDefaults({
  accountId: input.accountId,
  calendarType: input.calendarType,
  capabilities: resolveCalendarCapabilities(calendar.writable),
  name: calendar.name,
  originalName: calendar.name,
  userId: input.userId,
  ...resolveIdentityColumn(calendar),
});

const insertDiscoveredCalendars = (
  transaction: BunSQLTransactionClient,
  plan: CalendarRediscoveryPlan,
  input: CalendarRediscoveryApplyInput,
): Promise<InsertedCalendar[]> => {
  if (plan.toInsert.length === 0) {
    return Promise.resolve([]);
  }

  return transaction
    .insert(calendarsTable)
    .values(plan.toInsert.map((calendar) => buildInsertRow(calendar, input)))
    .returning({ id: calendarsTable.id, name: calendarsTable.name });
};

const applyCalendarRediscoveryPlan = (
  database: BunSQLDatabase,
  input: CalendarRediscoveryApplyInput,
): Promise<CalendarRediscoveryApplyResult> =>
  database.transaction(async (transaction: BunSQLTransactionClient) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(${USER_ACCOUNT_LOCK_NAMESPACE}, hashtext(${input.userId}))`,
    );

    const existing = await readExistingCalendars(transaction, input);
    const blockedKeys = await readCrossAccountCalDAVKeys(transaction, input);
    const removedKeys = await readRemovedKeys(transaction, input);
    const plan = planCalendarRediscovery({
      blockedKeys,
      discovered: input.discovered,
      enumerationStartedAt: input.now,
      existing,
      removedKeys,
    });

    if (plan.suppressed) {
      return { ...plan, inserted: [] };
    }

    const inserted = await insertDiscoveredCalendars(transaction, plan, input);

    if (plan.toRevive.length > 0) {
      await transaction
        .update(calendarsTable)
        .set({ unavailableSince: null })
        .where(inArray(calendarsTable.id, plan.toRevive));
    }

    if (plan.toMarkUnavailable.length > 0) {
      await transaction
        .update(calendarsTable)
        .set({ unavailableSince: input.now })
        .where(inArray(calendarsTable.id, plan.toMarkUnavailable));
    }

    for (const change of plan.toSetWritable) {
      await transaction
        .update(calendarsTable)
        .set({ capabilities: resolveCalendarCapabilities(change.writable) })
        .where(eq(calendarsTable.id, change.id));
    }

    for (const retarget of plan.toRetargetUrl) {
      await transaction
        .update(calendarsTable)
        .set({ calendarUrl: retarget.calendarUrl })
        .where(eq(calendarsTable.id, retarget.id));
    }

    await transaction
      .update(calendarAccountsTable)
      .set({ calendarsRefreshedAt: input.now })
      .where(eq(calendarAccountsTable.id, input.accountId));

    return { ...plan, inserted };
  });

const markCalendarRediscoveryAttempt = async (
  database: BunSQLDatabase,
  accountId: string,
  now: Date,
): Promise<void> => {
  await database
    .update(calendarAccountsTable)
    .set({ calendarsRefreshAttemptedAt: now })
    .where(eq(calendarAccountsTable.id, accountId));
};

export {
  USER_ACCOUNT_LOCK_NAMESPACE,
  applyCalendarRediscoveryPlan,
  markCalendarRediscoveryAttempt,
};
export type { CalendarRediscoveryApplyInput, CalendarRediscoveryApplyResult, InsertedCalendar };
