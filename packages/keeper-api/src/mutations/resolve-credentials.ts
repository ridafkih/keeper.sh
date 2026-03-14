import {
  calendarAccountsTable,
  caldavCredentialsTable,
  calendarsTable,
  oauthCredentialsTable,
  userEventsTable,
} from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import type { KeeperDatabase } from "../types";
import type { ProviderCredentials } from "../mutation-types";

const resolveCredentialsByCalendarId = async (
  database: KeeperDatabase,
  userId: string,
  calendarId: string,
): Promise<ProviderCredentials | null> => {
  const [result] = await database
    .select({
      calendarId: calendarsTable.id,
      externalCalendarId: calendarsTable.externalCalendarId,
      calendarUrl: calendarsTable.calendarUrl,
      provider: calendarAccountsTable.provider,
      email: calendarAccountsTable.email,
      needsReauthentication: calendarAccountsTable.needsReauthentication,
      oauthAccessToken: oauthCredentialsTable.accessToken,
      oauthRefreshToken: oauthCredentialsTable.refreshToken,
      oauthExpiresAt: oauthCredentialsTable.expiresAt,
      caldavServerUrl: caldavCredentialsTable.serverUrl,
      caldavUsername: caldavCredentialsTable.username,
      caldavEncryptedPassword: caldavCredentialsTable.encryptedPassword,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .leftJoin(oauthCredentialsTable, eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id))
    .leftJoin(caldavCredentialsTable, eq(calendarAccountsTable.caldavCredentialId, caldavCredentialsTable.id))
    .where(
      and(
        eq(calendarsTable.id, calendarId),
        eq(calendarsTable.userId, userId),
      ),
    )
    .limit(1);

  if (!result) {
    return null;
  }

  if (result.needsReauthentication) {
    return null;
  }

  const credentials: ProviderCredentials = {
    provider: result.provider,
    calendarId: result.calendarId,
    externalCalendarId: result.externalCalendarId,
    calendarUrl: result.calendarUrl,
    email: result.email,
  };

  if (result.oauthAccessToken && result.oauthRefreshToken && result.oauthExpiresAt) {
    credentials.oauth = {
      accessToken: result.oauthAccessToken,
      refreshToken: result.oauthRefreshToken,
      expiresAt: result.oauthExpiresAt,
    };
  }

  if (result.caldavServerUrl && result.caldavUsername && result.caldavEncryptedPassword) {
    credentials.caldav = {
      serverUrl: result.caldavServerUrl,
      username: result.caldavUsername,
      encryptedPassword: result.caldavEncryptedPassword,
    };
  }

  return credentials;
};

const resolveCredentialsByUserEventId = async (
  database: KeeperDatabase,
  userId: string,
  eventId: string,
): Promise<{ credentials: ProviderCredentials; sourceEventUid: string | null } | null> => {
  const [event] = await database
    .select({
      calendarId: userEventsTable.calendarId,
      sourceEventUid: userEventsTable.sourceEventUid,
    })
    .from(userEventsTable)
    .where(
      and(
        eq(userEventsTable.id, eventId),
        eq(userEventsTable.userId, userId),
      ),
    )
    .limit(1);

  if (!event) {
    return null;
  }

  const credentials = await resolveCredentialsByCalendarId(database, userId, event.calendarId);

  if (!credentials) {
    return null;
  }

  return { credentials, sourceEventUid: event.sourceEventUid };
};

export { resolveCredentialsByCalendarId, resolveCredentialsByUserEventId };
