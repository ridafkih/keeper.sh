import {
  calendarAccountsTable,
} from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import {
  exchangeCodeForTokens,
  fetchUserInfo,
  getDestinationAccountId,
  hasRequiredScopes,
  saveCalendarDestination,
  validateState,
} from "./destinations";
import { triggerDestinationSync } from "./sync";
import { oauthCallbackQuerySchema } from "./request-query";
import { baseUrl, database, premiumService } from "../context";

const MS_PER_SECOND = 1000;

interface OAuthCallbackParams {
  code: string | null;
  state: string | null;
  error: string | null;
  provider: string;
}

const parseOAuthCallback = (request: Request, provider: string): OAuthCallbackParams => {
  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());
  let parsedQuery: Record<string, string> = {};
  if (oauthCallbackQuerySchema.allows(query)) {
    parsedQuery = query;
  }

  return {
    code: parsedQuery.code ?? null,
    error: parsedQuery.error ?? null,
    provider,
    state: parsedQuery.state ?? null,
  };
};

const buildRedirectUrl = (path: string, params?: Record<string, string>): URL => {
  const url = new URL(path, baseUrl);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return url;
};

class OAuthError extends Error {
  constructor(
    message: string,
    public redirectUrl: URL,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

const ACCOUNT_LIMIT_ERROR_MESSAGE = "Account limit reached. Upgrade to Pro for unlimited accounts.";

const getExistingDestinationAccount = async (
  provider: string,
  accountId: string,
): Promise<{ id: string } | undefined> => {
  const [account] = await database
    .select({ id: calendarAccountsTable.id })
    .from(calendarAccountsTable)
    .where(
      and(
        eq(calendarAccountsTable.provider, provider),
        eq(calendarAccountsTable.accountId, accountId),
      ),
    )
    .limit(1);

  return account;
};

const ensureDestinationAccountAllowed = async (
  userId: string,
  provider: string,
  accountId: string,
): Promise<void> => {
  const existingAccount = await getExistingDestinationAccount(provider, accountId);
  if (existingAccount) {
    return;
  }

  const accounts = await database
    .select({ id: calendarAccountsTable.id })
    .from(calendarAccountsTable)
    .where(eq(calendarAccountsTable.userId, userId));

  const allowed = await premiumService.canAddAccount(userId, accounts.length);
  if (!allowed) {
    throw new OAuthError(
      "Account limit reached",
      buildRedirectUrl("/dashboard/integrations", {
        destination: "error",
        error: ACCOUNT_LIMIT_ERROR_MESSAGE,
      }),
    );
  }
};

const handleOAuthCallback = async (
  params: OAuthCallbackParams,
): Promise<{ userId: string; redirectUrl: URL }> => {
  const successUrl = buildRedirectUrl("/dashboard/integrations", {
    destination: "connected",
  });
  const errorUrl = buildRedirectUrl("/dashboard/integrations", {
    destination: "error",
  });

  if (!params.provider) {
    throw new OAuthError("Missing provider", errorUrl);
  }

  if (params.error) {
    throw new OAuthError("OAuth error from provider", errorUrl);
  }

  if (!params.code || !params.state) {
    throw new OAuthError("Missing code or state", errorUrl);
  }

  const validatedState = validateState(params.state);
  if (!validatedState) {
    throw new OAuthError("Invalid or expired state", errorUrl);
  }

  const { userId, destinationId } = validatedState;

  const callbackUrl = new URL(`/api/destinations/callback/${params.provider}`, baseUrl);
  const tokens = await exchangeCodeForTokens(params.provider, params.code, callbackUrl.toString());

  if (!tokens.refresh_token) {
    throw new OAuthError("No refresh token", errorUrl);
  }

  const userInfo = await fetchUserInfo(params.provider, tokens.access_token);
  const expiresAt = new Date(Date.now() + tokens.expires_in * MS_PER_SECOND);

  if (destinationId) {
    const existingAccountId = await getDestinationAccountId(destinationId);
    if (existingAccountId && existingAccountId !== userInfo.id) {
      throw new OAuthError(
        "Please reauthenticate with the same account",
        buildRedirectUrl("/dashboard/integrations", {
          error: "Please reauthenticate with the same account that was originally connected.",
        }),
      );
    }
  } else {
    await ensureDestinationAccountAllowed(userId, params.provider, userInfo.id);
  }

  const needsReauthentication = !hasRequiredScopes(params.provider, tokens.scope);

  await saveCalendarDestination(
    userId,
    params.provider,
    userInfo.id,
    userInfo.email,
    tokens.access_token,
    tokens.refresh_token,
    expiresAt,
    needsReauthentication,
  );

  triggerDestinationSync(userId);

  return { redirectUrl: successUrl, userId };
};

export { parseOAuthCallback, buildRedirectUrl, handleOAuthCallback, OAuthError };
