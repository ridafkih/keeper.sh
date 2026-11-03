import {
  caldavCredentialsTable,
  calendarAccountsTable,
  calendarsTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { encryptPassword } from "@keeper.sh/database";
import { database, premiumService, encryptionKey } from "@/context";
import { enqueuePushSync } from "./enqueue-push-sync";
import {
  createSourceCalendarInsertDependencies,
  insertSourceCalendars,
} from "./source-calendar-insert";
import {
  CalDAVSourceLimitError,
  importCalDAVCalendarsWithDependencies,
} from "./caldav-calendar-import";
import type {
  CalDAVAccountCredentials,
  CalDAVCalendarSelection,
  CalDAVImportResult,
  CalDAVImportTransaction,
  ConnectedCalDAVCalendar,
  ImportCalDAVCalendarsData,
} from "./caldav-calendar-import";

const FIRST_RESULT_LIMIT = 1;
const CALDAV_CALENDAR_TYPE = "caldav";
const USER_ACCOUNT_LOCK_NAMESPACE = 9002;
type CaldavImportDatabase = Pick<typeof database, "execute" | "insert" | "select">;

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

const getUserCalDAVSources = async (userId: string, provider?: string): Promise<CalDAVSource[]> => {
  const conditions = [
    eq(calendarsTable.userId, userId),
    eq(calendarsTable.calendarType, CALDAV_CALENDAR_TYPE),
    inArray(calendarsTable.id,
      database.selectDistinct({ id: sourceDestinationMappingsTable.sourceCalendarId })
        .from(sourceDestinationMappingsTable)
    ),
  ];

  if (provider) {
    conditions.push(eq(calendarAccountsTable.provider, provider));
  }

  const sources = await database
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
      throw new Error(`CalDAV source ${source.id} is missing calendarUrl`);
    }
    return {
      ...source,
      calendarUrl: source.calendarUrl,
      provider: source.provider,
    };
  });
};

const findConnectedCalDAVCalendars = async (
  client: CaldavImportDatabase,
  userId: string,
  calendarUrls: string[],
): Promise<ConnectedCalDAVCalendar[]> => {
  const rows = await client
    .select({
      accountId: calendarsTable.accountId,
      calendarUrl: calendarsTable.calendarUrl,
      id: calendarsTable.id,
      name: calendarsTable.name,
    })
    .from(calendarsTable)
    .where(
      and(
        eq(calendarsTable.userId, userId),
        eq(calendarsTable.calendarType, CALDAV_CALENDAR_TYPE),
        inArray(calendarsTable.calendarUrl, calendarUrls),
      ),
    );

  return rows.flatMap(({ calendarUrl, ...calendar }) => {
    if (!calendarUrl) {
      return [];
    }
    return [{ ...calendar, calendarUrl }];
  });
};

const findReusableCalDAVAccountId = async (
  client: CaldavImportDatabase,
  userId: string,
  credentials: CalDAVAccountCredentials,
): Promise<string | null> => {
  const [account] = await client
    .select({ id: calendarAccountsTable.id })
    .from(calendarAccountsTable)
    .innerJoin(
      caldavCredentialsTable,
      eq(calendarAccountsTable.caldavCredentialId, caldavCredentialsTable.id),
    )
    .where(
      and(
        eq(calendarAccountsTable.userId, userId),
        eq(calendarAccountsTable.provider, credentials.provider),
        eq(caldavCredentialsTable.serverUrl, credentials.serverUrl),
        eq(caldavCredentialsTable.username, credentials.username),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  return account?.id ?? null;
};

const countCalDAVImportAccounts = async (
  client: CaldavImportDatabase,
  userId: string,
): Promise<number> => {
  const [result] = await client
    .select({ value: count() })
    .from(calendarAccountsTable)
    .where(eq(calendarAccountsTable.userId, userId));

  return result?.value ?? 0;
};

const createCalDAVAccount = async (
  client: CaldavImportDatabase,
  userId: string,
  credentials: CalDAVAccountCredentials,
  resolvedEncryptionKey: string,
): Promise<string> => {
  const [credential] = await client
    .insert(caldavCredentialsTable)
    .values({
      authMethod: credentials.authMethod,
      encryptedPassword: encryptPassword(credentials.password, resolvedEncryptionKey),
      serverUrl: credentials.serverUrl,
      username: credentials.username,
    })
    .returning({ id: caldavCredentialsTable.id });

  if (!credential) {
    throw new Error("Failed to create CalDAV source credential");
  }

  const [account] = await client
    .insert(calendarAccountsTable)
    .values({
      authType: "caldav",
      caldavCredentialId: credential.id,
      displayName: credentials.username,
      provider: credentials.provider,
      userId,
    })
    .returning({ id: calendarAccountsTable.id });

  if (!account) {
    throw new Error("Failed to create calendar account");
  }

  return account.id;
};

const insertCalDAVCalendars = async (
  client: CaldavImportDatabase,
  userId: string,
  accountId: string,
  calendars: CalDAVCalendarSelection[],
): Promise<ConnectedCalDAVCalendar[]> => {
  const inserted = await insertSourceCalendars(
    createSourceCalendarInsertDependencies(client),
    userId,
    calendars.map(({ calendarUrl, name }) => ({
      accountId,
      calendarType: CALDAV_CALENDAR_TYPE,
      calendarUrl,
      capabilities: ["pull", "push"],
      name,
      originalName: name,
      userId,
    })),
  );

  return inserted.flatMap((calendar) => {
    if (!calendar.calendarUrl) {
      return [];
    }
    return [{
      accountId,
      calendarUrl: calendar.calendarUrl,
      id: calendar.id,
      name: calendar.name,
    }];
  });
};

const createCalDAVImportTransaction = (
  client: CaldavImportDatabase,
  userId: string,
  credentials: CalDAVAccountCredentials,
  resolvedEncryptionKey: string,
): CalDAVImportTransaction => ({
  countAccounts: () => countCalDAVImportAccounts(client, userId),
  createAccount: () => createCalDAVAccount(client, userId, credentials, resolvedEncryptionKey),
  findConnectedCalendars: (calendarUrls) =>
    findConnectedCalDAVCalendars(client, userId, calendarUrls),
  findReusableAccountId: () => findReusableCalDAVAccountId(client, userId, credentials),
  insertCalendars: (accountId, calendars) =>
    insertCalDAVCalendars(client, userId, accountId, calendars),
  lockUserAccounts: async () => {
    await client.execute(
      sql`select pg_advisory_xact_lock(${USER_ACCOUNT_LOCK_NAMESPACE}, hashtext(${userId}))`,
    );
  },
});

const importCalDAVCalendars = async (
  userId: string,
  { calendars, ...credentials }: ImportCalDAVCalendarsData,
): Promise<CalDAVImportResult> => {
  if (!encryptionKey) {
    throw new Error("Encryption key not configured");
  }

  const resolvedEncryptionKey = encryptionKey;

  const plan = await premiumService.getUserPlan(userId);
  if (!plan) {
    throw new Error("Unable to resolve user plan for sync enqueue");
  }

  const result = await importCalDAVCalendarsWithDependencies(calendars, {
    accountLimit: premiumService.getAccountLimit(plan),
    runInTransaction: (work) =>
      database.transaction((transaction) =>
        work(createCalDAVImportTransaction(transaction, userId, credentials, resolvedEncryptionKey))),
  });

  if (result.calendars.some(({ status }) => status === "imported")) {
    await enqueuePushSync(userId, plan);
  }

  return result;
};

const verifyCalDAVSourceOwnership = async (userId: string, calendarId: string): Promise<boolean> => {
  const [source] = await database
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
  CalDAVSourceLimitError,
  getUserCalDAVSources,
  importCalDAVCalendars,
  verifyCalDAVSourceOwnership,
};
