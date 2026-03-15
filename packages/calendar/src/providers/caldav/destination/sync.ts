import {
  calendarAccountsTable,
  caldavCredentialsTable,
  calendarsTable,
  eventStatesTable,
} from "@keeper.sh/database/schema";
import { decryptPassword } from "@keeper.sh/database";
import { and, arrayContains, asc, eq, gte, or } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { SyncableEvent } from "../../../core/types";
import type { CalDAVAccount, CalDAVService, CalDAVServiceConfig } from "../types";

const getStartOfToday = (): Date => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

const buildProviderCondition = (filter?: string): ReturnType<typeof eq> | ReturnType<typeof or> => {
  if (filter) {
    return eq(calendarAccountsTable.provider, filter);
  }
  return or(
    eq(calendarAccountsTable.provider, "caldav"),
    eq(calendarAccountsTable.provider, "fastmail"),
    eq(calendarAccountsTable.provider, "icloud"),
  );
};

const getDestinationScopeFilter = (_database: BunSQLDatabase) =>
  arrayContains(calendarsTable.capabilities, ["push"]);

const createCalDAVService = (config: CalDAVServiceConfig): CalDAVService => {
  const { database, encryptionKey } = config;

  const getCalDAVAccountsForUser = async (
    userId: string,
    providerFilter?: string,
  ): Promise<CalDAVAccount[]> => {
    const providerCondition = buildProviderCondition(providerFilter);

    const results = await database
      .select({
        accountId: calendarAccountsTable.accountId,
        calendarId: calendarsTable.id,
        calendarUrl: calendarsTable.calendarUrl,
        email: calendarAccountsTable.email,
        encryptedPassword: caldavCredentialsTable.encryptedPassword,
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
      .where(
        and(
          providerCondition,
          eq(calendarsTable.userId, userId),
          getDestinationScopeFilter(database),
        ),
      );

    return results.map((result) => ({
      ...result,
      calendarUrl: result.calendarUrl ?? "",
    }));
  };

  const getCalDAVAccountsByProvider = async (provider: string): Promise<CalDAVAccount[]> => {
    const results = await database
      .select({
        accountId: calendarAccountsTable.accountId,
        calendarId: calendarsTable.id,
        calendarUrl: calendarsTable.calendarUrl,
        email: calendarAccountsTable.email,
        encryptedPassword: caldavCredentialsTable.encryptedPassword,
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
      .where(
        and(
          eq(calendarAccountsTable.provider, provider),
          getDestinationScopeFilter(database),
        ),
      );

    return results.map((result) => ({
      ...result,
      calendarUrl: result.calendarUrl ?? "",
    }));
  };

  const getDecryptedPassword = (encryptedPassword: string): string =>
    decryptPassword(encryptedPassword, encryptionKey);

  const getUserEvents = async (userId: string): Promise<SyncableEvent[]> => {
    const today = getStartOfToday();

    const results = await database
      .select({
        calendarId: eventStatesTable.calendarId,
        calendarName: calendarsTable.name,
        calendarUrl: calendarsTable.url,
        endTime: eventStatesTable.endTime,
        id: eventStatesTable.id,
        sourceEventUid: eventStatesTable.sourceEventUid,
        startTime: eventStatesTable.startTime,
      })
      .from(eventStatesTable)
      .innerJoin(calendarsTable, eq(eventStatesTable.calendarId, calendarsTable.id))
      .where(and(eq(calendarsTable.userId, userId), gte(eventStatesTable.startTime, today)))
      .orderBy(asc(eventStatesTable.startTime));

    const events: SyncableEvent[] = [];

    for (const result of results) {
      if (result.sourceEventUid === null) {
        continue;
      }

      const summary = result.calendarName ?? "Busy";
      events.push({
        calendarId: result.calendarId,
        calendarName: result.calendarName,
        calendarUrl: result.calendarUrl,
        endTime: result.endTime,
        id: result.id,
        sourceEventUid: result.sourceEventUid,
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
