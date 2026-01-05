import {
  remoteICalSourcesTable,
  eventStatesTable,
  calendarDestinationsTable,
  caldavCredentialsTable,
} from "@keeper.sh/database/schema";
import { getStartOfToday } from "@keeper.sh/date-utils";
import { decryptPassword } from "@keeper.sh/encryption";
import { and, asc, eq, gte, or } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { SyncableEvent } from "@keeper.sh/integration";

export interface CalDAVAccount {
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

export interface CalDAVServiceConfig {
  database: BunSQLDatabase;
  encryptionKey: string;
}

export interface CalDAVService {
  getCalDAVAccountsForUser: (
    userId: string,
    providerFilter?: string,
  ) => Promise<CalDAVAccount[]>;
  getCalDAVAccountsByProvider: (provider: string) => Promise<CalDAVAccount[]>;
  getDecryptedPassword: (encryptedPassword: string) => string;
  getUserEvents: (userId: string) => Promise<SyncableEvent[]>;
}

export const createCalDAVService = (config: CalDAVServiceConfig): CalDAVService => {
  const { database, encryptionKey } = config;

  const getCalDAVAccountsForUser = async (
    userId: string,
    providerFilter?: string,
  ): Promise<CalDAVAccount[]> => {
    const providerCondition = providerFilter
      ? eq(calendarDestinationsTable.provider, providerFilter)
      : or(
          eq(calendarDestinationsTable.provider, "caldav"),
          eq(calendarDestinationsTable.provider, "fastmail"),
          eq(calendarDestinationsTable.provider, "icloud"),
        );

    const results = await database
      .select({
        destinationId: calendarDestinationsTable.id,
        userId: calendarDestinationsTable.userId,
        provider: calendarDestinationsTable.provider,
        accountId: calendarDestinationsTable.accountId,
        email: calendarDestinationsTable.email,
        serverUrl: caldavCredentialsTable.serverUrl,
        calendarUrl: caldavCredentialsTable.calendarUrl,
        username: caldavCredentialsTable.username,
        encryptedPassword: caldavCredentialsTable.encryptedPassword,
      })
      .from(calendarDestinationsTable)
      .innerJoin(
        caldavCredentialsTable,
        eq(
          calendarDestinationsTable.caldavCredentialId,
          caldavCredentialsTable.id,
        ),
      )
      .where(
        and(providerCondition, eq(calendarDestinationsTable.userId, userId)),
      );

    return results;
  };

  const getCalDAVAccountsByProvider = async (
    provider: string,
  ): Promise<CalDAVAccount[]> => {
    const results = await database
      .select({
        destinationId: calendarDestinationsTable.id,
        userId: calendarDestinationsTable.userId,
        provider: calendarDestinationsTable.provider,
        accountId: calendarDestinationsTable.accountId,
        email: calendarDestinationsTable.email,
        serverUrl: caldavCredentialsTable.serverUrl,
        calendarUrl: caldavCredentialsTable.calendarUrl,
        username: caldavCredentialsTable.username,
        encryptedPassword: caldavCredentialsTable.encryptedPassword,
      })
      .from(calendarDestinationsTable)
      .innerJoin(
        caldavCredentialsTable,
        eq(
          calendarDestinationsTable.caldavCredentialId,
          caldavCredentialsTable.id,
        ),
      )
      .where(eq(calendarDestinationsTable.provider, provider));

    return results;
  };

  const getDecryptedPassword = (encryptedPassword: string): string => {
    return decryptPassword(encryptedPassword, encryptionKey);
  };

  const getUserEvents = async (userId: string): Promise<SyncableEvent[]> => {
    const today = getStartOfToday();

    const results = await database
      .select({
        id: eventStatesTable.id,
        sourceEventUid: eventStatesTable.sourceEventUid,
        startTime: eventStatesTable.startTime,
        endTime: eventStatesTable.endTime,
        sourceId: eventStatesTable.sourceId,
        sourceName: remoteICalSourcesTable.name,
        sourceUrl: remoteICalSourcesTable.url,
      })
      .from(eventStatesTable)
      .innerJoin(
        remoteICalSourcesTable,
        eq(eventStatesTable.sourceId, remoteICalSourcesTable.id),
      )
      .where(
        and(
          eq(remoteICalSourcesTable.userId, userId),
          gte(eventStatesTable.startTime, today),
        ),
      )
      .orderBy(asc(eventStatesTable.startTime));

    const events: SyncableEvent[] = [];

    for (const result of results) {
      if (result.sourceEventUid === null) continue;

      events.push({
        id: result.id,
        sourceEventUid: result.sourceEventUid,
        startTime: result.startTime,
        endTime: result.endTime,
        sourceId: result.sourceId,
        sourceName: result.sourceName,
        sourceUrl: result.sourceUrl,
        summary: result.sourceName ?? "Busy",
      });
    }

    return events;
  };

  return {
    getCalDAVAccountsForUser,
    getCalDAVAccountsByProvider,
    getDecryptedPassword,
    getUserEvents,
  };
};
