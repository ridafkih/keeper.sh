import { calendarAccountsTable, caldavCredentialsTable, calendarsTable } from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import { openSecret } from "@keeper.sh/database";
import type {
  CalDAVSourceAccount,
  CalDAVSourceProviderConfig,
  StoredCalDAVPassword,
} from "../types";

const CALDAV_CALENDAR_TYPE = "caldav";

interface CalDAVSourceService {
  getAllCalDAVSources: () => Promise<CalDAVSourceAccount[]>;
  getCalDAVSourcesByProvider: (provider: string) => Promise<CalDAVSourceAccount[]>;
  getCalDAVSourcesForUser: (userId: string) => Promise<CalDAVSourceAccount[]>;
  getDecryptedPassword: (
    credential: Pick<CalDAVSourceAccount, "caldavCredentialId" | "encryptedPassword">,
  ) => string;
  updateSyncToken: (calendarId: string, syncToken: string | null) => Promise<void>;
}

const mapSourceToAccount = (source: {
  authMethod: string;
  caldavCredentialId: string;
  calendarAccountId: string;
  calendarUrl: string | null;
  encryptedPassword: StoredCalDAVPassword;
  name: string;
  originalName: string | null;
  provider: string;
  serverUrl: string;
  calendarId: string;
  syncToken: string | null;
  userId: string;
  username: string;
}): CalDAVSourceAccount => {
  if (!source.calendarUrl) {
    throw new Error(`CalDAV source ${source.calendarId} is missing calendarUrl`);
  }
  return {
    ...source,
    calendarUrl: source.calendarUrl,
    provider: source.provider,
  };
};

const createCalDAVSourceService = (config: CalDAVSourceProviderConfig): CalDAVSourceService => {
  const { database, keyring } = config;

  const getAllCalDAVSources = async (): Promise<CalDAVSourceAccount[]> => {
    const sources = await database
      .select({
        authMethod: caldavCredentialsTable.authMethod,
        caldavCredentialId: caldavCredentialsTable.id,
        calendarAccountId: calendarAccountsTable.id,
        calendarId: calendarsTable.id,
        calendarUrl: calendarsTable.calendarUrl,
        encryptedPassword: caldavCredentialsTable.encryptedPassword,
        name: calendarsTable.name,
        originalName: calendarsTable.originalName,
        provider: calendarAccountsTable.provider,
        serverUrl: caldavCredentialsTable.serverUrl,
        syncToken: calendarsTable.syncToken,
        userId: calendarsTable.userId,
        username: caldavCredentialsTable.username,
      })
      .from(calendarsTable)
      .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
      .innerJoin(
        caldavCredentialsTable,
        eq(calendarAccountsTable.caldavCredentialId, caldavCredentialsTable.id),
      )
      .where(
        and(
          eq(calendarsTable.calendarType, CALDAV_CALENDAR_TYPE),
        ),
      );

    return sources.map((source) => mapSourceToAccount(source));
  };

  const getCalDAVSourcesByProvider = async (provider: string): Promise<CalDAVSourceAccount[]> => {
    const sources = await database
      .select({
        authMethod: caldavCredentialsTable.authMethod,
        caldavCredentialId: caldavCredentialsTable.id,
        calendarAccountId: calendarAccountsTable.id,
        calendarId: calendarsTable.id,
        calendarUrl: calendarsTable.calendarUrl,
        encryptedPassword: caldavCredentialsTable.encryptedPassword,
        name: calendarsTable.name,
        originalName: calendarsTable.originalName,
        provider: calendarAccountsTable.provider,
        serverUrl: caldavCredentialsTable.serverUrl,
        syncToken: calendarsTable.syncToken,
        userId: calendarsTable.userId,
        username: caldavCredentialsTable.username,
      })
      .from(calendarsTable)
      .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
      .innerJoin(
        caldavCredentialsTable,
        eq(calendarAccountsTable.caldavCredentialId, caldavCredentialsTable.id),
      )
      .where(
        and(
          eq(calendarsTable.calendarType, CALDAV_CALENDAR_TYPE),
          eq(calendarAccountsTable.provider, provider),
        ),
      );

    return sources.map((source) => mapSourceToAccount(source));
  };

  const getCalDAVSourcesForUser = async (userId: string): Promise<CalDAVSourceAccount[]> => {
    const sources = await database
      .select({
        authMethod: caldavCredentialsTable.authMethod,
        caldavCredentialId: caldavCredentialsTable.id,
        calendarAccountId: calendarAccountsTable.id,
        calendarId: calendarsTable.id,
        calendarUrl: calendarsTable.calendarUrl,
        encryptedPassword: caldavCredentialsTable.encryptedPassword,
        name: calendarsTable.name,
        originalName: calendarsTable.originalName,
        provider: calendarAccountsTable.provider,
        serverUrl: caldavCredentialsTable.serverUrl,
        syncToken: calendarsTable.syncToken,
        userId: calendarsTable.userId,
        username: caldavCredentialsTable.username,
      })
      .from(calendarsTable)
      .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
      .innerJoin(
        caldavCredentialsTable,
        eq(calendarAccountsTable.caldavCredentialId, caldavCredentialsTable.id),
      )
      .where(
        and(
          eq(calendarsTable.calendarType, CALDAV_CALENDAR_TYPE),
          eq(calendarsTable.userId, userId),
        ),
      );

    return sources.map((source) => mapSourceToAccount(source));
  };

  const getDecryptedPassword = (
    credential: Pick<CalDAVSourceAccount, "caldavCredentialId" | "encryptedPassword">,
  ): string => openSecret(credential.encryptedPassword, keyring, credential.caldavCredentialId);

  const updateSyncToken = async (calendarId: string, syncToken: string | null): Promise<void> => {
    await database
      .update(calendarsTable)
      .set({ syncToken })
      .where(eq(calendarsTable.id, calendarId));
  };

  return {
    getAllCalDAVSources,
    getCalDAVSourcesByProvider,
    getCalDAVSourcesForUser,
    getDecryptedPassword,
    updateSyncToken,
  };
};

export { createCalDAVSourceService };
export type { CalDAVSourceService };
