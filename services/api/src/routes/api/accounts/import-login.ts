import { account as accountTable, user as userTable } from "@keeper.sh/database/auth-schema";
import { calendarAccountsTable } from "@keeper.sh/database/schema";
import { and, count, eq, inArray } from "drizzle-orm";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { database, oauthProviders, redis } from "@/context";
import { checkAndClaimLoginImport } from "@/utils/sync-trigger-limit";
import { fetchUserInfo } from "@/utils/destinations";
import { createOAuthSourceCredential } from "@/utils/oauth-source-credentials";
import { importOAuthAccountCalendars } from "@/utils/oauth-sources";
import { handleImportLoginRoute, LOGIN_PROVIDER_IDS } from "./import-login-route";

const MS_PER_SECOND = 1000;

const POST = withWideEvent(
  withAuth(({ userId }) =>
    handleImportLoginRoute({ userId }, {
      claimImport: (id) => checkAndClaimLoginImport(redis, id),
      createCredential: createOAuthSourceCredential,
      fetchUserInfo,
      importCalendars: importOAuthAccountCalendars,
      loadEligibility: async (id) => {
        const [[signup], [accounts]] = await Promise.all([
          database.select({ createdAt: userTable.createdAt }).from(userTable).where(eq(userTable.id, id)).limit(1),
          database.select({ value: count() }).from(calendarAccountsTable).where(eq(calendarAccountsTable.userId, id)),
        ]);
        return { calendarAccountCount: accounts?.value ?? 0, userCreatedAt: signup?.createdAt ?? null };
      },
      loadLoginAccounts: (id) =>
        database
          .select({
            accessToken: accountTable.accessToken,
            accessTokenExpiresAt: accountTable.accessTokenExpiresAt,
            accountId: accountTable.accountId,
            providerId: accountTable.providerId,
            refreshToken: accountTable.refreshToken,
            scope: accountTable.scope,
          })
          .from(accountTable)
          .where(and(eq(accountTable.userId, id), inArray(accountTable.providerId, LOGIN_PROVIDER_IDS))),
      now: () => Date.now(),
      refreshToken: async (provider, refreshToken) => {
        const oauthProvider = oauthProviders.getProvider(provider);
        if (!oauthProvider) {
          throw new Error(`OAuth provider not found: ${provider}`);
        }
        const tokens = await oauthProvider.refreshAccessToken(refreshToken);
        return {
          accessToken: tokens.access_token,
          expiresAt: new Date(Date.now() + tokens.expires_in * MS_PER_SECOND),
          refreshToken: tokens.refresh_token,
        };
      },
    })),
);

export { POST };
