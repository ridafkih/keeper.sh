import {
  calendarAccountsTable,
  calendarsTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { and, count, eq } from "drizzle-orm";
import type { database as contextDatabase } from "@/context";
import { applySourceSyncDefaults } from "./source-sync-defaults";

const FIRST_RESULT_LIMIT = 1;
const OAUTH_CALENDAR_TYPE = "oauth";

type OAuthSourceDatabase = Pick<typeof contextDatabase, "insert" | "select" | "selectDistinct">;

interface ExternalCalendar {
  externalId: string;
  name: string;
}

interface CreateOAuthSourcePayload {
  accountId: string;
  externalCalendarId: string;
  name: string;
  originalName: string;
  provider: string;
  userId: string;
  excludeFocusTime: boolean;
  excludeOutOfOffice: boolean;
  excludeWorkingLocation: boolean;
}

interface CreateOAuthAccountIdOptions {
  userId: string;
  provider: string;
  oauthCredentialId: string;
  email: string | null;
}

const countUserAccountsWithDatabase = async (
  databaseClient: OAuthSourceDatabase,
  userId: string,
): Promise<number> => {
  const [result] = await databaseClient
    .select({ value: count() })
    .from(calendarAccountsTable)
    .where(eq(calendarAccountsTable.userId, userId));

  return result?.value ?? 0;
};

const findOAuthAccountIdWithDatabase = async (
  databaseClient: OAuthSourceDatabase,
  options: {
    userId: string;
    provider: string;
    oauthCredentialId: string;
  },
): Promise<string | null> => {
  const { userId, provider, oauthCredentialId } = options;

  const [existingAccount] = await databaseClient
    .select({ id: calendarAccountsTable.id })
    .from(calendarAccountsTable)
    .where(
      and(
        eq(calendarAccountsTable.userId, userId),
        eq(calendarAccountsTable.provider, provider),
        eq(calendarAccountsTable.oauthCredentialId, oauthCredentialId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  return existingAccount?.id ?? null;
};

const hasExistingOAuthCalendarWithDatabase = async (
  databaseClient: OAuthSourceDatabase,
  options: {
    externalCalendarId: string;
    oauthCredentialId: string;
    userId: string;
  },
): Promise<boolean> => {
  const { externalCalendarId, oauthCredentialId, userId } = options;

  const [existingCalendar] = await databaseClient
    .select({ id: calendarsTable.id })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .where(
      and(
        eq(calendarsTable.userId, userId),
        eq(calendarsTable.externalCalendarId, externalCalendarId),
        eq(calendarAccountsTable.oauthCredentialId, oauthCredentialId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  return Boolean(existingCalendar);
};

const createOAuthSourceRecordWithDatabase = async (
  databaseClient: OAuthSourceDatabase,
  payload: CreateOAuthSourcePayload,
): Promise<{ id: string; name: string } | null> => {
  const [source] = await databaseClient
    .insert(calendarsTable)
    .values(applySourceSyncDefaults({
      accountId: payload.accountId,
      calendarType: OAUTH_CALENDAR_TYPE,
      capabilities: ["pull", "push"],
      excludeFocusTime: payload.excludeFocusTime,
      excludeOutOfOffice: payload.excludeOutOfOffice,
      excludeWorkingLocation: payload.excludeWorkingLocation,
      externalCalendarId: payload.externalCalendarId,
      name: payload.name,
      originalName: payload.originalName,
      userId: payload.userId,
    }))
    .returning();

  if (!source) {
    return null;
  }

  return {
    id: source.id,
    name: source.name,
  };
};

const findCredentialEmailWithDatabase = async (
  databaseClient: OAuthSourceDatabase,
  userId: string,
  oauthCredentialId: string,
): Promise<{ email: string | null; exists: boolean }> => {
  const [credential] = await databaseClient
    .select({ email: oauthCredentialsTable.email })
    .from(oauthCredentialsTable)
    .where(
      and(
        eq(oauthCredentialsTable.id, oauthCredentialId),
        eq(oauthCredentialsTable.userId, userId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  return {
    email: credential?.email ?? null,
    exists: Boolean(credential),
  };
};

const createOAuthAccountIdWithDatabase = async (
  databaseClient: OAuthSourceDatabase,
  options: CreateOAuthAccountIdOptions,
): Promise<string | null> => {
  const { userId, provider, oauthCredentialId, email } = options;

  const [insertedAccount] = await databaseClient
    .insert(calendarAccountsTable)
    .values({
      authType: "oauth",
      displayName: email,
      email,
      oauthCredentialId,
      provider,
      userId,
    })
    .returning({ id: calendarAccountsTable.id });

  return insertedAccount?.id ?? null;
};

const getUnimportedExternalCalendarsWithDatabase = async (
  databaseClient: OAuthSourceDatabase,
  userId: string,
  accountId: string,
  externalCalendars: ExternalCalendar[],
): Promise<ExternalCalendar[]> => {
  const existingCalendars = await databaseClient
    .select({ externalCalendarId: calendarsTable.externalCalendarId })
    .from(calendarsTable)
    .where(
      and(
        eq(calendarsTable.accountId, accountId),
        eq(calendarsTable.userId, userId),
      ),
    );

  const existingExternalIds = new Set(
    existingCalendars.map((calendar) => calendar.externalCalendarId),
  );

  return externalCalendars.filter(
    (externalCalendar) => !existingExternalIds.has(externalCalendar.externalId),
  );
};

const insertOAuthCalendarsWithDatabase = async (
  databaseClient: OAuthSourceDatabase,
  userId: string,
  accountId: string,
  calendars: ExternalCalendar[],
): Promise<void> => {
  if (calendars.length === 0) {
    return;
  }

  await databaseClient
    .insert(calendarsTable)
    .values(
      calendars.map((calendar) => applySourceSyncDefaults({
        accountId,
        calendarType: OAUTH_CALENDAR_TYPE,
        capabilities: ["pull", "push"],
        externalCalendarId: calendar.externalId,
        name: calendar.name,
        originalName: calendar.name,
        userId,
      })),
    );
};

export {
  countUserAccountsWithDatabase,
  createOAuthAccountIdWithDatabase,
  createOAuthSourceRecordWithDatabase,
  findCredentialEmailWithDatabase,
  findOAuthAccountIdWithDatabase,
  getUnimportedExternalCalendarsWithDatabase,
  hasExistingOAuthCalendarWithDatabase,
  insertOAuthCalendarsWithDatabase,
};
export type {
  CreateOAuthAccountIdOptions,
  CreateOAuthSourcePayload,
  ExternalCalendar,
  OAuthSourceDatabase,
};
