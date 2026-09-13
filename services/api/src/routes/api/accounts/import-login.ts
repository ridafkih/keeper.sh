import { account as accountTable } from "@keeper.sh/database/auth-schema";
import { and, eq, inArray } from "drizzle-orm";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { database, oauthProviders } from "@/context";
import { fetchUserInfo } from "@/utils/destinations";
import { createOAuthSourceCredential } from "@/utils/oauth-source-credentials";
import { importOAuthAccountCalendars } from "@/utils/oauth-sources";
import { handleImportLoginRoute, LOGIN_PROVIDER_IDS } from "./import-login-route";

const MS_PER_SECOND = 1000;

const POST = withWideEvent(
  withAuth(({ userId }) =>
    handleImportLoginRoute({ userId }, {
      createCredential: createOAuthSourceCredential,
      fetchUserInfo,
      importCalendars: importOAuthAccountCalendars,
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
        };
      },
    })),
);

export { POST };
