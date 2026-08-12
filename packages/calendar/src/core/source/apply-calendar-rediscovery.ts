import { applySourceSyncDefaults } from "@keeper.sh/data-schemas";
import {
  calendarAccountsTable,
  caldavCredentialsTable,
  calendarsTable,
} from "@keeper.sh/database/schema";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { BunSQLTransactionClient } from "../database-client";
import {
  normalizeCalDAVCalendarKey,
  normalizeCalDAVServerHost,
} from "../../providers/caldav/shared/calendar-identity";
import { planCalendarRediscovery, toExistingCalendars } from "./calendar-rediscovery";
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

/*
 * The host comparison stays in application code so it uses the same URL parser as the
 * CalDAV identity rule. A SQL pattern cannot reproduce punycode folding for
 * internationalized domains or bracketed IPv6 literals, and a host that parses
 * differently on each side silently disables the guard.
 */
const toBlockedKey = (
  row: { calendarUrl: string | null; serverUrl: string },
  caldavServerHost: string,
): string[] => {
  if (!row.calendarUrl || normalizeCalDAVServerHost(row.serverUrl) !== caldavServerHost) {
    return [];
  }
  return [normalizeCalDAVCalendarKey(row.calendarUrl)];
};

const readCrossAccountCalDAVKeys = async (
  transaction: BunSQLTransactionClient,
  input: CalendarRediscoveryApplyInput,
): Promise<Set<string>> => {
  const { caldavServerHost } = input;
  if (!caldavServerHost) {
    return new Set<string>();
  }

  const rows = await transaction
    .select({
      calendarUrl: calendarsTable.calendarUrl,
      serverUrl: caldavCredentialsTable.serverUrl,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .innerJoin(
      caldavCredentialsTable,
      eq(calendarAccountsTable.caldavCredentialId, caldavCredentialsTable.id),
    )
    .where(and(
      eq(calendarsTable.userId, input.userId),
      ne(calendarsTable.accountId, input.accountId),
      eq(calendarAccountsTable.authType, "caldav"),
    ));

  return new Set(
    rows.flatMap((row) => toBlockedKey(row, caldavServerHost)),
  );
};

const resolveCapabilities = (writable: boolean): string[] => {
  if (writable) {
    return ["pull", "push"];
  }
  return ["pull"];
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
  capabilities: resolveCapabilities(calendar.writable),
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
    const plan = planCalendarRediscovery({
      blockedKeys,
      discovered: input.discovered,
      enumerationStartedAt: input.now,
      existing,
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
