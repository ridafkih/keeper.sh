import {
  caldavCredentialsTable,
  calendarAccountsTable,
  calendarsTable,
} from "@keeper.sh/database/schema";
import { and, eq, ne } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { BunSQLClient } from "../database-client";
import {
  normalizeCalDAVCalendarKey,
  normalizeCalDAVServerHost,
} from "../../providers/caldav/shared/calendar-identity";

interface UserCalDAVCalendar {
  id: string;
  accountId: string;
  name: string;
  calendarUrl: string;
  identityKey: string;
}

interface UserCalDAVCalendarsQuery {
  userId: string;
  caldavServerHost: string;
  excludeAccountId?: string;
}

interface UserCalDAVCalendarRow {
  id: string;
  accountId: string;
  name: string;
  calendarUrl: string | null;
  serverUrl: string;
}

type UserCalDAVCalendarsClient = Pick<BunSQLClient, "select">;

/*
 * The host comparison stays in application code so it uses the same URL parser as the
 * CalDAV identity rule. A SQL pattern cannot reproduce punycode folding for
 * internationalized domains or bracketed IPv6 literals, and a host that parses
 * differently on each side silently disables the guard.
 */
const toUserCalDAVCalendar = (
  row: UserCalDAVCalendarRow,
  caldavServerHost: string,
): UserCalDAVCalendar[] => {
  if (!row.calendarUrl || normalizeCalDAVServerHost(row.serverUrl) !== caldavServerHost) {
    return [];
  }
  return [{
    accountId: row.accountId,
    calendarUrl: row.calendarUrl,
    id: row.id,
    identityKey: normalizeCalDAVCalendarKey(row.calendarUrl),
    name: row.name,
  }];
};

const buildConditions = (query: UserCalDAVCalendarsQuery): SQL[] => {
  const conditions = [
    eq(calendarsTable.userId, query.userId),
    eq(calendarAccountsTable.authType, "caldav"),
  ];
  if (query.excludeAccountId) {
    conditions.push(ne(calendarsTable.accountId, query.excludeAccountId));
  }
  return conditions;
};

const findUserCalDAVCalendarsOnServer = async (
  client: UserCalDAVCalendarsClient,
  query: UserCalDAVCalendarsQuery,
): Promise<UserCalDAVCalendar[]> => {
  const rows = await client
    .select({
      accountId: calendarsTable.accountId,
      calendarUrl: calendarsTable.calendarUrl,
      id: calendarsTable.id,
      name: calendarsTable.name,
      serverUrl: caldavCredentialsTable.serverUrl,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .innerJoin(
      caldavCredentialsTable,
      eq(calendarAccountsTable.caldavCredentialId, caldavCredentialsTable.id),
    )
    .where(and(...buildConditions(query)));

  return rows.flatMap((row) => toUserCalDAVCalendar(row, query.caldavServerHost));
};

export { findUserCalDAVCalendarsOnServer };
export type { UserCalDAVCalendar, UserCalDAVCalendarsQuery };
