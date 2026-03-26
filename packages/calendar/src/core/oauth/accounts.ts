import {
  calendarAccountsTable,
  calendarsTable,
  eventStatesTable,
  oauthCredentialsTable,
  userSubscriptionsTable,
} from "@keeper.sh/database/schema";
import { and, arrayContains, asc, eq, gte } from "drizzle-orm";
import type { Plan } from "@keeper.sh/data-schemas";
import type { SyncableEvent } from "../types";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { getOAuthSyncWindowStart } from "./sync-window";

interface OAuthAccount {
  calendarId: string;
  userId: string;
  accountId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
}

const getDestinationScopeFilter = (_database: BunSQLDatabase) =>
  arrayContains(calendarsTable.capabilities, ["push"]);

const getOAuthAccountsByPlan = async (
  database: BunSQLDatabase,
  provider: string,
  targetPlan: Plan,
): Promise<OAuthAccount[]> => {
  const results = await database
    .select({
      accessToken: oauthCredentialsTable.accessToken,
      accessTokenExpiresAt: oauthCredentialsTable.expiresAt,
      accountId: calendarAccountsTable.accountId,
      calendarId: calendarsTable.id,
      plan: userSubscriptionsTable.plan,
      refreshToken: oauthCredentialsTable.refreshToken,
      userId: calendarsTable.userId,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .innerJoin(
      oauthCredentialsTable,
      eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id),
    )
    .leftJoin(
      userSubscriptionsTable,
      eq(calendarsTable.userId, userSubscriptionsTable.userId),
    )
    .where(
      and(
        eq(calendarAccountsTable.provider, provider),
        eq(calendarAccountsTable.needsReauthentication, false),
        getDestinationScopeFilter(database),
      ),
    );

  const accounts: OAuthAccount[] = [];

  for (const result of results) {
    const { plan, accessToken, refreshToken, accessTokenExpiresAt, accountId } = result;
    const userPlan = plan ?? "pro";

    if (userPlan !== targetPlan) {
      continue;
    }

    accounts.push({
      accessToken,
      accessTokenExpiresAt,
      accountId: accountId ?? "",
      calendarId: result.calendarId,
      refreshToken,
      userId: result.userId,
    });
  }

  return accounts;
};

const getOAuthAccountsForUser = async (
  database: BunSQLDatabase,
  provider: string,
  userId: string,
): Promise<OAuthAccount[]> => {
  const results = await database
    .select({
      accessToken: oauthCredentialsTable.accessToken,
      accessTokenExpiresAt: oauthCredentialsTable.expiresAt,
      accountId: calendarAccountsTable.accountId,
      calendarId: calendarsTable.id,
      refreshToken: oauthCredentialsTable.refreshToken,
      userId: calendarsTable.userId,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .innerJoin(
      oauthCredentialsTable,
      eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id),
    )
    .where(
      and(
        eq(calendarAccountsTable.provider, provider),
        eq(calendarsTable.userId, userId),
        eq(calendarAccountsTable.needsReauthentication, false),
        getDestinationScopeFilter(database),
      ),
    );

  return results.map((result) => ({
    accessToken: result.accessToken,
    accessTokenExpiresAt: result.accessTokenExpiresAt,
    accountId: result.accountId ?? "",
    calendarId: result.calendarId,
    refreshToken: result.refreshToken,
    userId: result.userId,
  }));
};

const getUserEventsForSync = async (
  database: BunSQLDatabase,
  userId: string,
): Promise<SyncableEvent[]> => {
  const syncWindowStart = getOAuthSyncWindowStart();

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
    .where(and(eq(calendarsTable.userId, userId), gte(eventStatesTable.startTime, syncWindowStart)))
    .orderBy(asc(eventStatesTable.startTime));

  const events: SyncableEvent[] = [];

  for (const result of results) {
    if (result.sourceEventUid === null) {
      continue;
    }

    events.push({
      calendarId: result.calendarId,
      calendarName: result.calendarName,
      calendarUrl: result.calendarUrl,
      endTime: result.endTime,
      id: result.id,
      sourceEventUid: result.sourceEventUid,
      startTime: result.startTime,
      summary: result.calendarName ?? "Busy",
    });
  }

  return events;
};

export { getOAuthAccountsByPlan, getOAuthAccountsForUser, getUserEventsForSync };
export type { OAuthAccount };
