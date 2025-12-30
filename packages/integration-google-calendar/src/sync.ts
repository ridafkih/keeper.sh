import {
  remoteICalSourcesTable,
  eventStatesTable,
  userSubscriptionsTable,
  calendarDestinationsTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { and, asc, eq, gte } from "drizzle-orm";
import type { Plan } from "@keeper.sh/premium";
import type { SyncableEvent } from "@keeper.sh/integrations";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

export interface GoogleAccount {
  destinationId: string;
  userId: string;
  accountId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
}

export const getGoogleAccountsByPlan = async (
  database: BunSQLDatabase,
  targetPlan: Plan,
): Promise<GoogleAccount[]> => {
  const results = await database
    .select({
      destinationId: calendarDestinationsTable.id,
      userId: calendarDestinationsTable.userId,
      accountId: calendarDestinationsTable.accountId,
      accessToken: oauthCredentialsTable.accessToken,
      refreshToken: oauthCredentialsTable.refreshToken,
      accessTokenExpiresAt: oauthCredentialsTable.expiresAt,
      plan: userSubscriptionsTable.plan,
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
        eq(calendarDestinationsTable.provider, "google"),
        eq(calendarDestinationsTable.needsReauthentication, false),
      ),
    );

  const accounts: GoogleAccount[] = [];

  for (const result of results) {
    const { plan, accessToken, refreshToken, accessTokenExpiresAt, accountId } = result;
    const userPlan = plan ?? "free";

    if (userPlan !== targetPlan) {
      continue;
    }

    accounts.push({
      destinationId: result.destinationId,
      userId: result.userId,
      accountId,
      accessToken,
      refreshToken,
      accessTokenExpiresAt,
    });
  }

  return accounts;
};

export const getGoogleAccountsForUser = async (
  database: BunSQLDatabase,
  userId: string,
): Promise<GoogleAccount[]> => {
  const results = await database
    .select({
      destinationId: calendarDestinationsTable.id,
      userId: calendarDestinationsTable.userId,
      accountId: calendarDestinationsTable.accountId,
      accessToken: oauthCredentialsTable.accessToken,
      refreshToken: oauthCredentialsTable.refreshToken,
      accessTokenExpiresAt: oauthCredentialsTable.expiresAt,
    })
    .from(calendarDestinationsTable)
    .innerJoin(
      oauthCredentialsTable,
      eq(calendarDestinationsTable.oauthCredentialId, oauthCredentialsTable.id),
    )
    .where(
      and(
        eq(calendarDestinationsTable.provider, "google"),
        eq(calendarDestinationsTable.userId, userId),
        eq(calendarDestinationsTable.needsReauthentication, false),
      ),
    );

  return results.map((result) => ({
    destinationId: result.destinationId,
    userId: result.userId,
    accountId: result.accountId,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    accessTokenExpiresAt: result.accessTokenExpiresAt,
  }));
};

export const getUserEvents = async (
  database: BunSQLDatabase,
  userId: string,
): Promise<SyncableEvent[]> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

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

