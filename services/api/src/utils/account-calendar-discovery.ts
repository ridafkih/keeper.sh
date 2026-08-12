import {
  caldavCredentialsTable,
  calendarAccountsTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { decryptPassword } from "@keeper.sh/database";
import {
  resolveRediscoveryCalendarType,
  toDiscoveredCalDAVCalendars,
  toDiscoveredGoogleCalendars,
  toDiscoveredOutlookCalendars,
} from "@keeper.sh/calendar";
import type { DiscoveredCalendar, RediscoveryCalendarType } from "@keeper.sh/calendar";
import {
  createCalDAVClient,
  resolveCalDAVServerHost,
} from "@keeper.sh/calendar/caldav";
import { listUserCalendars as listGoogleCalendars } from "@keeper.sh/calendar/google";
import { listUserCalendars as listOutlookCalendars } from "@keeper.sh/calendar/outlook";
import { and, eq } from "drizzle-orm";
import type { CalDAVAuthMethod } from "@keeper.sh/calendar/digest-fetch";
import { safeFetchOptions } from "./safe-fetch-options";
import {
  refreshGoogleSourceAccessToken,
  refreshMicrosoftSourceAccessToken,
} from "./oauth-refresh";

const FIRST_RESULT_LIMIT = 1;

interface RefreshableAccount {
  id: string;
  userId: string;
  provider: string;
  authType: string;
  calendarType: RediscoveryCalendarType;
  caldavServerHost?: string | null;
}

const isExpired = (expiresAt: Date): boolean => expiresAt < new Date();

const resolveSourceAccessToken = async (
  provider: string,
  credential: { id: string; accessToken: string; refreshToken: string; expiresAt: Date },
): Promise<string> => {
  if (!isExpired(credential.expiresAt)) {
    return credential.accessToken;
  }

  if (provider === "google") {
    const refreshed = await refreshGoogleSourceAccessToken(
      credential.id,
      credential.refreshToken,
    );
    return refreshed.accessToken;
  }

  const refreshed = await refreshMicrosoftSourceAccessToken(
    credential.id,
    credential.refreshToken,
  );
  return refreshed.accessToken;
};

const discoverOAuthAccountCalendars = async (
  accountId: string,
  provider: string,
): Promise<DiscoveredCalendar[]> => {
  const { database } = await import("@/context");

  const [credential] = await database
    .select({
      accessToken: oauthCredentialsTable.accessToken,
      expiresAt: oauthCredentialsTable.expiresAt,
      id: oauthCredentialsTable.id,
      refreshToken: oauthCredentialsTable.refreshToken,
    })
    .from(calendarAccountsTable)
    .innerJoin(
      oauthCredentialsTable,
      eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id),
    )
    .where(eq(calendarAccountsTable.id, accountId))
    .limit(FIRST_RESULT_LIMIT);

  if (!credential) {
    throw new Error(`Calendar account ${accountId} has no OAuth credential`);
  }

  const accessToken = await resolveSourceAccessToken(provider, credential);

  if (provider === "google") {
    return toDiscoveredGoogleCalendars(await listGoogleCalendars(accessToken));
  }

  return toDiscoveredOutlookCalendars(await listOutlookCalendars(accessToken));
};

const discoverCalDAVAccountCalendars = async (
  accountId: string,
  encryptionKey: string,
): Promise<DiscoveredCalendar[]> => {
  const { database } = await import("@/context");

  const [credential] = await database
    .select({
      authMethod: caldavCredentialsTable.authMethod,
      encryptedPassword: caldavCredentialsTable.encryptedPassword,
      serverUrl: caldavCredentialsTable.serverUrl,
      username: caldavCredentialsTable.username,
    })
    .from(calendarAccountsTable)
    .innerJoin(
      caldavCredentialsTable,
      eq(calendarAccountsTable.caldavCredentialId, caldavCredentialsTable.id),
    )
    .where(eq(calendarAccountsTable.id, accountId))
    .limit(FIRST_RESULT_LIMIT);

  if (!credential) {
    throw new Error(`Calendar account ${accountId} has no CalDAV credential`);
  }

  const client = createCalDAVClient({
    authMethod: credential.authMethod as CalDAVAuthMethod,
    credentials: {
      password: decryptPassword(credential.encryptedPassword, encryptionKey),
      username: credential.username,
    },
    serverUrl: credential.serverUrl,
  }, safeFetchOptions);

  return toDiscoveredCalDAVCalendars(await client.discoverCalendars());
};

const markAccountNeedsReauthentication = async (accountId: string): Promise<void> => {
  const { database } = await import("@/context");

  await database
    .update(calendarAccountsTable)
    .set({ needsReauthentication: true })
    .where(eq(calendarAccountsTable.id, accountId));
};

const loadRefreshableAccount = async (
  accountId: string,
  userId: string,
): Promise<RefreshableAccount | null> => {
  const { database } = await import("@/context");

  const [account] = await database
    .select({
      authType: calendarAccountsTable.authType,
      id: calendarAccountsTable.id,
      provider: calendarAccountsTable.provider,
      serverUrl: caldavCredentialsTable.serverUrl,
      userId: calendarAccountsTable.userId,
    })
    .from(calendarAccountsTable)
    .leftJoin(
      caldavCredentialsTable,
      eq(calendarAccountsTable.caldavCredentialId, caldavCredentialsTable.id),
    )
    .where(and(
      eq(calendarAccountsTable.id, accountId),
      eq(calendarAccountsTable.userId, userId),
    ))
    .limit(FIRST_RESULT_LIMIT);

  if (!account) {
    return null;
  }

  return {
    authType: account.authType,
    caldavServerHost: resolveCalDAVServerHost(account.serverUrl),
    calendarType: resolveRediscoveryCalendarType(account.authType),
    id: account.id,
    provider: account.provider,
    userId: account.userId,
  };
};

export {
  discoverCalDAVAccountCalendars,
  discoverOAuthAccountCalendars,
  loadRefreshableAccount,
  markAccountNeedsReauthentication,
};
export type { RefreshableAccount };
