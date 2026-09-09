import { calendarAccountsTable, oauthCredentialsTable } from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { getAuthorizationUrl, isOAuthProvider } from "@/utils/destinations";
import { sourceAuthorizeQuerySchema } from "@/utils/request-query";
import { baseUrl, database } from "@/context";

const FIRST_RESULT_LIMIT = 1;

interface ReconnectTarget {
  credentialId: string | null;
  loginHint: string | null;
}

/**
 * Resolves the account being restored. The login hint is read from the stored row rather than
 * the query so a reconnect can only ever target the account that actually broke.
 */
const resolveReconnectTarget = async (
  userId: string,
  accountId: string,
): Promise<ReconnectTarget | null> => {
  const [account] = await database
    .select({
      credentialId: calendarAccountsTable.oauthCredentialId,
      email: calendarAccountsTable.email,
    })
    .from(calendarAccountsTable)
    .where(
      and(
        eq(calendarAccountsTable.id, accountId),
        eq(calendarAccountsTable.userId, userId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  if (!account) {
    return null;
  }

  /* Only an email can pin a consent screen. calendar_accounts.accountId holds an opaque
     provider identifier, so hinting with it would suppress Microsoft's account picker
     while naming an account it cannot resolve. */
  const email = account.email?.trim();
  if (!email) {
    return { credentialId: account.credentialId, loginHint: null };
  }

  return { credentialId: account.credentialId, loginHint: email };
};

const userOwnsSourceCredential = async (userId: string, credentialId: string): Promise<boolean> => {
  const [credential] = await database
    .select({ id: oauthCredentialsTable.id })
    .from(oauthCredentialsTable)
    .where(
      and(
        eq(oauthCredentialsTable.id, credentialId),
        eq(oauthCredentialsTable.userId, userId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  return Boolean(credential);
};

const GET = withWideEvent(
  withAuth(async ({ request, userId }) => {
    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const provider = url.searchParams.get("provider");
    const accountId = url.searchParams.get("accountId");
    let credentialId = url.searchParams.get("credentialId");
    let loginHint: string | null = null;

    if (
      !sourceAuthorizeQuerySchema.allows(query)
      || !provider
      || !isOAuthProvider(provider)
    ) {
      return ErrorResponse.badRequest("Unsupported provider").toResponse();
    }

    if (accountId) {
      const target = await resolveReconnectTarget(userId, accountId);
      if (!target) {
        return ErrorResponse.notFound("Calendar account not found").toResponse();
      }
      ({ credentialId, loginHint } = target);
    }

    if (credentialId) {
      const ownsCredential = await userOwnsSourceCredential(userId, credentialId);
      if (!ownsCredential) {
        return ErrorResponse.notFound("Source credential not found").toResponse();
      }
    }

    const callbackUrl = new URL(`/api/sources/callback/${provider}`, baseUrl);
    const authorizationOptions: {
      callbackUrl: string;
      sourceCredentialId?: string;
      loginHint?: string;
    } = {
      callbackUrl: callbackUrl.toString(),
    };
    if (credentialId) {
      authorizationOptions.sourceCredentialId = credentialId;
    }
    if (loginHint) {
      authorizationOptions.loginHint = loginHint;
    }
    const authUrl = await getAuthorizationUrl(provider, userId, authorizationOptions);

    return Response.redirect(authUrl);
  }),
);

export { GET };
