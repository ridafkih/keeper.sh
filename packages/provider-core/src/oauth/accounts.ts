import {
  calendarDestinationsTable,
  eventStatesTable,
  oauthCredentialsTable,
  remoteICalSourcesTable,
  userSubscriptionsTable,
} from "@keeper.sh/database/schema";
import { getStartOfToday } from "@keeper.sh/date-utils";
import { and, asc, eq, gte } from "drizzle-orm";
import type { Plan } from "@keeper.sh/premium";
import type { SyncableEvent } from "../types";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

interface OAuthAccount {
  destinationId: string;
  userId: string;
  accountId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
}

const getOAuthAccountsByPlan = async (
  database: BunSQLDatabase,
  provider: string,
  targetPlan: Plan,
): Promise<OAuthAccount[]> => {
  const results = await database
    .select({
      accessToken: oauthCredentialsTable.accessToken,
      accessTokenExpiresAt: oauthCredentialsTable.expiresAt,
      accountId: calendarDestinationsTable.accountId,
      destinationId: calendarDestinationsTable.id,
      plan: userSubscriptionsTable.plan,
      refreshToken: oauthCredentialsTable.refreshToken,
      userId: calendarDestinationsTable.userId,
    })
    .from(calendarDestinationsTable)
    .innerJoin(
      oauthCredentialsTable,
      eq(calendarDestinationsTable.oauthCredentialId, oauthCredentialsTable.id),
    )
    .leftJoin(
      userSubscriptionsTable,
      eq(calendarDestinationsTable.userId, userSubscriptionsTable.userId),
    )
    .where(
      and(
        eq(calendarDestinationsTable.provider, provider),
        eq(calendarDestinationsTable.needsReauthentication, false),
      ),
    );

  const accounts: OAuthAccount[] = [];

  for (const result of results) {
    const { plan, accessToken, refreshToken, accessTokenExpiresAt, accountId } = result;
    const userPlan = plan ?? "free";

    if (userPlan !== targetPlan) {
      continue;
    }

    accounts.push({
      accessToken,
      accessTokenExpiresAt,
      accountId,
      destinationId: result.destinationId,
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
      accountId: calendarDestinationsTable.accountId,
      destinationId: calendarDestinationsTable.id,
      refreshToken: oauthCredentialsTable.refreshToken,
      userId: calendarDestinationsTable.userId,
    })
    .from(calendarDestinationsTable)
    .innerJoin(
      oauthCredentialsTable,
      eq(calendarDestinationsTable.oauthCredentialId, oauthCredentialsTable.id),
    )
    .where(
      and(
        eq(calendarDestinationsTable.provider, provider),
        eq(calendarDestinationsTable.userId, userId),
        eq(calendarDestinationsTable.needsReauthentication, false),
      ),
    );

  return results.map((result) => ({
    accessToken: result.accessToken,
    accessTokenExpiresAt: result.accessTokenExpiresAt,
    accountId: result.accountId,
    destinationId: result.destinationId,
    refreshToken: result.refreshToken,
    userId: result.userId,
  }));
};

const getUserEventsForSync = async (
  database: BunSQLDatabase,
  userId: string,
): Promise<SyncableEvent[]> => {
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

    events.push({
      endTime: result.endTime,
      id: result.id,
      sourceEventUid: result.sourceEventUid,
      sourceId: result.sourceId,
      sourceName: result.sourceName,
      sourceUrl: result.sourceUrl,
      startTime: result.startTime,
      summary: result.sourceName ?? "Busy",
    });
  }

  return events;
};

export { getOAuthAccountsByPlan, getOAuthAccountsForUser, getUserEventsForSync };
export type { OAuthAccount };
