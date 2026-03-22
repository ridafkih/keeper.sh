import {
  caldavCredentialsTable,
  calendarAccountsTable,
  calendarsTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { and, count, eq, inArray } from "drizzle-orm";
import { CalDAVSourceMissingCalendarUrlError } from "./caldav-source-errors";
import type { database } from "@/context";

const FIRST_RESULT_LIMIT = 1;
const CALDAV_CALENDAR_TYPE = "caldav";

type CaldavSourceDatabase = Pick<
  typeof database,
  "insert" | "select" | "selectDistinct"
>;

interface CalDAVSource {
  id: string;
  accountId: string;
  userId: string;
  name: string;
  provider: string;
  calendarUrl: string;
  serverUrl: string;
  username: string;
  createdAt: Date;
}

const findReusableCalDAVAccountWithDatabase = async (
  databaseClient: CaldavSourceDatabase,
  userId: string,
  provider: string,
  serverUrl: string,
  username: string,
): Promise<{ id: string; caldavCredentialId: string | null } | undefined> => {
  const [account] = await databaseClient
    .select({
      id: calendarAccountsTable.id,
      caldavCredentialId: calendarAccountsTable.caldavCredentialId,
    })
    .from(calendarAccountsTable)
    .innerJoin(
      caldavCredentialsTable,
      eq(calendarAccountsTable.caldavCredentialId, caldavCredentialsTable.id),
    )
    .where(
      and(
        eq(calendarAccountsTable.userId, userId),
        eq(calendarAccountsTable.provider, provider),
        eq(caldavCredentialsTable.serverUrl, serverUrl),
        eq(caldavCredentialsTable.username, username),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  return account;
};

const countUserAccountsWithDatabase = async (
  databaseClient: CaldavSourceDatabase,
  userId: string,
): Promise<number> => {
  const [result] = await databaseClient
    .select({ value: count() })
    .from(calendarAccountsTable)
    .where(eq(calendarAccountsTable.userId, userId));

  return result?.value ?? 0;
};

const getUserCalDAVSourcesWithDatabase = async (
  databaseClient: CaldavSourceDatabase,
  userId: string,
  provider?: string,
): Promise<CalDAVSource[]> => {
  const conditions = [
    eq(calendarsTable.userId, userId),
    eq(calendarsTable.calendarType, CALDAV_CALENDAR_TYPE),
    inArray(
      calendarsTable.id,
      databaseClient
        .selectDistinct({ id: sourceDestinationMappingsTable.sourceCalendarId })
        .from(sourceDestinationMappingsTable),
    ),
  ];

  if (provider) {
    conditions.push(eq(calendarAccountsTable.provider, provider));
  }

  const sources = await databaseClient
    .select({
      accountId: calendarAccountsTable.id,
      calendarUrl: calendarsTable.calendarUrl,
      createdAt: calendarsTable.createdAt,
      id: calendarsTable.id,
      name: calendarsTable.name,
      provider: calendarAccountsTable.provider,
      serverUrl: caldavCredentialsTable.serverUrl,
      userId: calendarsTable.userId,
      username: caldavCredentialsTable.username,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .innerJoin(
      caldavCredentialsTable,
      eq(calendarAccountsTable.caldavCredentialId, caldavCredentialsTable.id),
    )
    .where(and(...conditions));

  return sources.map((source) => {
    if (!source.calendarUrl) {
      throw new CalDAVSourceMissingCalendarUrlError(source.id);
    }
    return {
      ...source,
      calendarUrl: source.calendarUrl,
      provider: source.provider,
    };
  });
};

const verifyCalDAVSourceOwnershipWithDatabase = async (
  databaseClient: CaldavSourceDatabase,
  userId: string,
  calendarId: string,
): Promise<boolean> => {
  const [source] = await databaseClient
    .select({ id: calendarsTable.id })
    .from(calendarsTable)
    .where(
      and(
        eq(calendarsTable.id, calendarId),
        eq(calendarsTable.userId, userId),
        eq(calendarsTable.calendarType, CALDAV_CALENDAR_TYPE),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  return Boolean(source);
};

export {
  findReusableCalDAVAccountWithDatabase,
  countUserAccountsWithDatabase,
  getUserCalDAVSourcesWithDatabase,
  verifyCalDAVSourceOwnershipWithDatabase,
};
export type {
  CaldavSourceDatabase,
  CalDAVSource,
};
