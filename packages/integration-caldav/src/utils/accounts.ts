import {
  caldavCredentialsTable,
  calendarDestinationsTable,
  eventStatesTable,
  remoteICalSourcesTable,
} from "@keeper.sh/database/schema";
import { getStartOfToday } from "@keeper.sh/date-utils";
import { decryptPassword } from "@keeper.sh/encryption";
import { and, asc, eq, gte, or } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { SyncableEvent } from "@keeper.sh/integration";

interface CalDAVAccount {
  destinationId: string;
  userId: string;
  provider: string;
  accountId: string;
  email: string | null;
  serverUrl: string;
  calendarUrl: string;
  username: string;
  encryptedPassword: string;
}

interface CalDAVServiceConfig {
  database: BunSQLDatabase;
  encryptionKey: string;
}

interface CalDAVService {
  getCalDAVAccountsForUser: (userId: string, providerFilter?: string) => Promise<CalDAVAccount[]>;
  getCalDAVAccountsByProvider: (provider: string) => Promise<CalDAVAccount[]>;
  getDecryptedPassword: (encryptedPassword: string) => string;
  getUserEvents: (userId: string) => Promise<SyncableEvent[]>;
}

const buildProviderCondition = (
  filter?: string,
): ReturnType<typeof eq> | ReturnType<typeof or> => {
  if (filter) {
    return eq(calendarDestinationsTable.provider, filter);
  }
  return or(
    eq(calendarDestinationsTable.provider, "caldav"),
    eq(calendarDestinationsTable.provider, "fastmail"),
    eq(calendarDestinationsTable.provider, "icloud"),
  );
};

const createCalDAVService = (config: CalDAVServiceConfig): CalDAVService => {
  const { database, encryptionKey } = config;

  const getCalDAVAccountsForUser = async (
    userId: string,
    providerFilter?: string,
  ): Promise<CalDAVAccount[]> => {
    const providerCondition = buildProviderCondition(providerFilter);

    const results = await database
      .select({
        accountId: calendarDestinationsTable.accountId,
        calendarUrl: caldavCredentialsTable.calendarUrl,
        destinationId: calendarDestinationsTable.id,
        email: calendarDestinationsTable.email,
        encryptedPassword: caldavCredentialsTable.encryptedPassword,
        provider: calendarDestinationsTable.provider,
        serverUrl: caldavCredentialsTable.serverUrl,
        userId: calendarDestinationsTable.userId,
        username: caldavCredentialsTable.username,
      })
      .from(calendarDestinationsTable)
      .innerJoin(
        caldavCredentialsTable,
        eq(calendarDestinationsTable.caldavCredentialId, caldavCredentialsTable.id),
      )
      .where(and(providerCondition, eq(calendarDestinationsTable.userId, userId)));

    return results;
  };

  const getCalDAVAccountsByProvider = async (provider: string): Promise<CalDAVAccount[]> => {
    const results = await database
      .select({
        accountId: calendarDestinationsTable.accountId,
        calendarUrl: caldavCredentialsTable.calendarUrl,
        destinationId: calendarDestinationsTable.id,
        email: calendarDestinationsTable.email,
        encryptedPassword: caldavCredentialsTable.encryptedPassword,
        provider: calendarDestinationsTable.provider,
        serverUrl: caldavCredentialsTable.serverUrl,
        userId: calendarDestinationsTable.userId,
        username: caldavCredentialsTable.username,
      })
      .from(calendarDestinationsTable)
      .innerJoin(
        caldavCredentialsTable,
        eq(calendarDestinationsTable.caldavCredentialId, caldavCredentialsTable.id),
      )
      .where(eq(calendarDestinationsTable.provider, provider));

    return results;
  };

  const getDecryptedPassword = (encryptedPassword: string): string =>
    decryptPassword(encryptedPassword, encryptionKey);

  const getUserEvents = async (userId: string): Promise<SyncableEvent[]> => {
    const today = getStartOfToday();

    const results = await database
      .select({
        endTime: eventStatesTable.endTime,
        id: eventStatesTable.id,
        sourceEventUid: eventStatesTable.sourceEventUid,
        sourceId: eventStatesTable.sourceId,
        sourceName: remoteICalSourcesTable.name,
        sourceUrl: remoteICalSourcesTable.url,
        startTime: eventStatesTable.startTime,
      })
      .from(eventStatesTable)
      .innerJoin(remoteICalSourcesTable, eq(eventStatesTable.sourceId, remoteICalSourcesTable.id))
      .where(and(eq(remoteICalSourcesTable.userId, userId), gte(eventStatesTable.startTime, today)))
      .orderBy(asc(eventStatesTable.startTime));

    const events: SyncableEvent[] = [];

    for (const result of results) {
      if (result.sourceEventUid === null) {
        continue;
      }

      const summary = result.sourceName ?? "Busy";
      events.push({
        endTime: result.endTime,
        id: result.id,
        sourceEventUid: result.sourceEventUid,
        sourceId: result.sourceId,
        sourceName: result.sourceName,
        sourceUrl: result.sourceUrl,
        startTime: result.startTime,
        summary,
      });
    }

    return events;
  };

  return {
    getCalDAVAccountsByProvider,
    getCalDAVAccountsForUser,
    getDecryptedPassword,
    getUserEvents,
  };
};

export { createCalDAVService };
export type { CalDAVAccount, CalDAVServiceConfig, CalDAVService };
