import {
  calendarAccountsTable,
  caldavCredentialsTable,
  calendarsTable,
  eventStatesTable,
  oauthCredentialsTable,
  userEventsTable,
} from "@keeper.sh/database/schema";
import { and, arrayContains, eq } from "drizzle-orm";
import type { KeeperDatabase } from "../types";
import type { ProviderCredentials } from "../mutation-types";

const credentialColumns = {
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
};

interface CredentialRow {
  calendarId: string;
  externalCalendarId: string | null;
  calendarUrl: string | null;
  provider: string;
  email: string | null;
  needsReauthentication: boolean;
  oauthAccessToken: string | null;
  oauthRefreshToken: string | null;
  oauthExpiresAt: Date | null;
  caldavServerUrl: string | null;
  caldavUsername: string | null;
  caldavEncryptedPassword: string | null;
}

const rowToCredentials = (row: CredentialRow): ProviderCredentials => {
  const credentials: ProviderCredentials = {
    provider: row.provider,
    calendarId: row.calendarId,
    externalCalendarId: row.externalCalendarId,
    calendarUrl: row.calendarUrl,
    email: row.email,
  };

  if (row.oauthAccessToken && row.oauthRefreshToken && row.oauthExpiresAt) {
    credentials.oauth = {
      accessToken: row.oauthAccessToken,
      refreshToken: row.oauthRefreshToken,
      expiresAt: row.oauthExpiresAt,
    };
  }

  if (row.caldavServerUrl && row.caldavUsername && row.caldavEncryptedPassword) {
    credentials.caldav = {
      serverUrl: row.caldavServerUrl,
      username: row.caldavUsername,
      encryptedPassword: row.caldavEncryptedPassword,
    };
  }

  return credentials;
};

const resolveCredentialsByCalendarId = async (
  database: KeeperDatabase,
  userId: string,
  calendarId: string,
): Promise<ProviderCredentials | null> => {
  const [result] = await database
    .select(credentialColumns)
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

  return rowToCredentials(result);
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

type EventSource = "user" | "synced";

interface ResolvedEventCredentials {
  credentials: ProviderCredentials;
  sourceEventUid: string | null;
  eventSource: EventSource;
}

const resolveCredentialsByEventId = async (
  database: KeeperDatabase,
  userId: string,
  eventId: string,
): Promise<ResolvedEventCredentials | null> => {
  const userResult = await resolveCredentialsByUserEventId(database, userId, eventId);

  if (userResult) {
    return { ...userResult, eventSource: "user" };
  }

  const [syncedEvent] = await database
    .select({
      calendarId: eventStatesTable.calendarId,
      sourceEventUid: eventStatesTable.sourceEventUid,
    })
    .from(eventStatesTable)
    .innerJoin(calendarsTable, eq(eventStatesTable.calendarId, calendarsTable.id))
    .where(
      and(
        eq(eventStatesTable.id, eventId),
        eq(calendarsTable.userId, userId),
      ),
    )
    .limit(1);

  if (!syncedEvent) {
    return null;
  }

  const credentials = await resolveCredentialsByCalendarId(database, userId, syncedEvent.calendarId);

  if (!credentials) {
    return null;
  }

  return {
    credentials,
    sourceEventUid: syncedEvent.sourceEventUid,
    eventSource: "synced",
  };
};

const resolveAllSourceCredentials = async (
  database: KeeperDatabase,
  userId: string,
): Promise<ProviderCredentials[]> => {
  const results = await database
    .select(credentialColumns)
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .leftJoin(oauthCredentialsTable, eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id))
    .leftJoin(caldavCredentialsTable, eq(calendarAccountsTable.caldavCredentialId, caldavCredentialsTable.id))
    .where(
      and(
        eq(calendarsTable.userId, userId),
        arrayContains(calendarsTable.capabilities, ["pull"]),
        eq(calendarAccountsTable.needsReauthentication, false),
      ),
    );

  return results.map((row) => rowToCredentials(row));
};

export { resolveCredentialsByCalendarId, resolveCredentialsByUserEventId, resolveCredentialsByEventId, resolveAllSourceCredentials };
export type { EventSource, ResolvedEventCredentials };
