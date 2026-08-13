import {
  calendarAccountsTable,
  calendarsTable,
  oauthCredentialsTable,
  userSubscriptionsTable,
} from "@keeper.sh/database/schema";
import { and, arrayContains, eq } from "drizzle-orm";
import type { Plan } from "@keeper.sh/data-schemas";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

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
        getDestinationScopeFilter(database),
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

export { getOAuthAccountsByPlan, getOAuthAccountsForUser };
export type { OAuthAccount };
