import { database } from "@keeper.sh/database";
import {
  remoteICalSourcesTable,
  eventStatesTable,
  userSubscriptionsTable,
  calendarDestinationsTable,
} from "@keeper.sh/database/schema";
import { and, asc, eq, gte } from "drizzle-orm";
import type { Plan } from "@keeper.sh/premium";
import type { SyncableEvent } from "@keeper.sh/integrations";

export interface GoogleAccount {
  userId: string;
  accountId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
}

export const getGoogleAccountsByPlan = async (
  targetPlan: Plan,
): Promise<GoogleAccount[]> => {
  const results = await database
    .select({
      userId: calendarDestinationsTable.userId,
      accountId: calendarDestinationsTable.accountId,
      accessToken: calendarDestinationsTable.accessToken,
      refreshToken: calendarDestinationsTable.refreshToken,
      accessTokenExpiresAt: calendarDestinationsTable.accessTokenExpiresAt,
      plan: userSubscriptionsTable.plan,
    })
    .from(calendarDestinationsTable)
    .leftJoin(
      userSubscriptionsTable,
      eq(calendarDestinationsTable.userId, userSubscriptionsTable.userId),
    )
    .where(eq(calendarDestinationsTable.provider, "google"));

  const accounts: GoogleAccount[] = [];

  for (const result of results) {
    const { plan, accessToken, refreshToken, accessTokenExpiresAt } = result;
    const userPlan = plan ?? "free";

    if (userPlan !== targetPlan) {
      continue;
    }

    accounts.push({
      userId: result.userId,
      accountId: result.accountId,
      accessToken,
      refreshToken,
      accessTokenExpiresAt,
    });
  }

  return accounts;
};

export const getGoogleAccountForUser = async (
  userId: string,
): Promise<GoogleAccount | null> => {
  const results = await database
    .select({
      userId: calendarDestinationsTable.userId,
      accountId: calendarDestinationsTable.accountId,
      accessToken: calendarDestinationsTable.accessToken,
      refreshToken: calendarDestinationsTable.refreshToken,
      accessTokenExpiresAt: calendarDestinationsTable.accessTokenExpiresAt,
    })
    .from(calendarDestinationsTable)
    .where(
      and(
        eq(calendarDestinationsTable.provider, "google"),
        eq(calendarDestinationsTable.userId, userId),
      ),
    )
    .limit(1);

  const result = results[0];
  if (!result) {
    return null;
  }

  return {
    userId: result.userId,
    accountId: result.accountId,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    accessTokenExpiresAt: result.accessTokenExpiresAt,
  };
};

export const getUserEvents = async (userId: string): Promise<SyncableEvent[]> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const results = await database
    .select({
      id: eventStatesTable.id,
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

  return results.map(({ id, startTime, endTime, sourceId, sourceName, sourceUrl }) => ({
    id,
    startTime,
    endTime,
    sourceId,
    sourceName,
    sourceUrl,
    summary: sourceName ?? "Busy",
  }));
};

