import {
  caldavSourceCredentialsTable,
  calendarSourcesTable,
} from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import { decryptPassword } from "@keeper.sh/encryption";
import type { CalDAVSourceAccount, CalDAVSourceProviderConfig } from "../types";

const CALDAV_SOURCE_TYPE = "caldav";

interface CalDAVSourceService {
  getAllCalDAVSources: () => Promise<CalDAVSourceAccount[]>;
  getCalDAVSourcesByProvider: (provider: string) => Promise<CalDAVSourceAccount[]>;
  getCalDAVSourcesForUser: (userId: string) => Promise<CalDAVSourceAccount[]>;
  getDecryptedPassword: (encryptedPassword: string) => string;
  updateSyncToken: (sourceId: string, syncToken: string | null) => Promise<void>;
}

const mapSourceToAccount = (source: {
  calendarUrl: string | null;
  encryptedPassword: string;
  name: string;
  provider: string | null;
  serverUrl: string;
  sourceId: string;
  syncToken: string | null;
  userId: string;
  username: string;
}): CalDAVSourceAccount => {
  if (!source.calendarUrl) {
    throw new Error(`CalDAV source ${source.sourceId} is missing calendarUrl`);
  }
  if (!source.provider) {
    throw new Error(`CalDAV source ${source.sourceId} is missing provider`);
  }
  return {
    ...source,
    calendarUrl: source.calendarUrl,
    provider: source.provider,
  };
};

const createCalDAVSourceService = (config: CalDAVSourceProviderConfig): CalDAVSourceService => {
  const { database, encryptionKey } = config;

  const getAllCalDAVSources = async (): Promise<CalDAVSourceAccount[]> => {
    const sources = await database
      .select({
        calendarUrl: calendarSourcesTable.calendarUrl,
        encryptedPassword: caldavSourceCredentialsTable.encryptedPassword,
        name: calendarSourcesTable.name,
        provider: calendarSourcesTable.provider,
        serverUrl: caldavSourceCredentialsTable.serverUrl,
        sourceId: calendarSourcesTable.id,
        syncToken: calendarSourcesTable.syncToken,
        userId: calendarSourcesTable.userId,
        username: caldavSourceCredentialsTable.username,
      })
      .from(calendarSourcesTable)
      .innerJoin(
        caldavSourceCredentialsTable,
        eq(calendarSourcesTable.caldavCredentialId, caldavSourceCredentialsTable.id),
      )
      .where(eq(calendarSourcesTable.sourceType, CALDAV_SOURCE_TYPE));

    return sources.map((source) => mapSourceToAccount(source));
  };

  const getCalDAVSourcesByProvider = async (provider: string): Promise<CalDAVSourceAccount[]> => {
    const sources = await database
      .select({
        calendarUrl: calendarSourcesTable.calendarUrl,
        encryptedPassword: caldavSourceCredentialsTable.encryptedPassword,
        name: calendarSourcesTable.name,
        provider: calendarSourcesTable.provider,
        serverUrl: caldavSourceCredentialsTable.serverUrl,
        sourceId: calendarSourcesTable.id,
        syncToken: calendarSourcesTable.syncToken,
        userId: calendarSourcesTable.userId,
        username: caldavSourceCredentialsTable.username,
      })
      .from(calendarSourcesTable)
      .innerJoin(
        caldavSourceCredentialsTable,
        eq(calendarSourcesTable.caldavCredentialId, caldavSourceCredentialsTable.id),
      )
      .where(
        and(
          eq(calendarSourcesTable.sourceType, CALDAV_SOURCE_TYPE),
          eq(calendarSourcesTable.provider, provider),
        ),
      );

    return sources.map((source) => mapSourceToAccount(source));
  };

  const getCalDAVSourcesForUser = async (userId: string): Promise<CalDAVSourceAccount[]> => {
    const sources = await database
      .select({
        calendarUrl: calendarSourcesTable.calendarUrl,
        encryptedPassword: caldavSourceCredentialsTable.encryptedPassword,
        name: calendarSourcesTable.name,
        provider: calendarSourcesTable.provider,
        serverUrl: caldavSourceCredentialsTable.serverUrl,
        sourceId: calendarSourcesTable.id,
        syncToken: calendarSourcesTable.syncToken,
        userId: calendarSourcesTable.userId,
        username: caldavSourceCredentialsTable.username,
      })
      .from(calendarSourcesTable)
      .innerJoin(
        caldavSourceCredentialsTable,
        eq(calendarSourcesTable.caldavCredentialId, caldavSourceCredentialsTable.id),
      )
      .where(
        and(
          eq(calendarSourcesTable.sourceType, CALDAV_SOURCE_TYPE),
          eq(calendarSourcesTable.userId, userId),
        ),
      );

    return sources.map((source) => mapSourceToAccount(source));
  };

  const getDecryptedPassword = (encryptedPassword: string): string =>
    decryptPassword(encryptedPassword, encryptionKey);

  const updateSyncToken = async (sourceId: string, syncToken: string | null): Promise<void> => {
    await database
      .update(calendarSourcesTable)
      .set({ syncToken })
      .where(eq(calendarSourcesTable.id, sourceId));
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
