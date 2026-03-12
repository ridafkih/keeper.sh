import {
  calendarAccountsTable,
} from "@keeper.sh/database/schema";
import type { ValidatedState } from "@keeper.sh/provider-core";
import { and, eq, sql } from "drizzle-orm";
import type { database as contextDatabase } from "../context";
import { oauthCallbackQuerySchema } from "./request-query";

const MS_PER_SECOND = 1000;
const USER_ACCOUNT_LOCK_NAMESPACE = 9002;

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

const buildRedirectUrl = (
  path: string,
  baseUrl: string,
  params?: Record<string, string>,
): URL => {
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

interface OAuthUserInfo {
  email: string | null;
  id: string;
}

interface OAuthTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

interface HandleOAuthCallbackDependencies {
  baseUrl: string;
  exchangeCodeForTokens: (
    provider: string,
    code: string,
    callbackUrl: string,
  ) => Promise<OAuthTokenResponse>;
  fetchUserInfo: (provider: string, accessToken: string) => Promise<OAuthUserInfo>;
  getDestinationAccountId: (userId: string, destinationId: string) => Promise<string | null>;
  hasRequiredScopes: (provider: string, scope: string) => boolean | Promise<boolean>;
  persistCalendarDestination: (payload: {
    accountId: string;
    accessToken: string;
    destinationId?: string;
    email: string | null;
    expiresAt: Date;
    needsReauthentication: boolean;
    provider: string;
    refreshToken: string;
    userId: string;
  }) => Promise<void>;
  triggerDestinationSync: (userId: string) => void;
  validateState: (state: string) => Promise<ValidatedState | null>;
}

const getExistingDestinationAccount = async (
  databaseClient: Pick<typeof contextDatabase, "select">,
  provider: string,
  accountId: string,
): Promise<{ id: string } | undefined> => {
  const [account] = await databaseClient
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

const handleOAuthCallbackWithDependencies = async (
  params: OAuthCallbackParams,
  dependencies: HandleOAuthCallbackDependencies,
): Promise<{ userId: string; redirectUrl: URL }> => {
  const successUrl = new URL("/dashboard/integrations", dependencies.baseUrl);
  successUrl.searchParams.set("destination", "connected");
  const errorUrl = new URL("/dashboard/integrations", dependencies.baseUrl);
  errorUrl.searchParams.set("destination", "error");

  if (!params.provider) {
    throw new OAuthError("Missing provider", errorUrl);
  }

  if (params.error) {
    throw new OAuthError("OAuth error from provider", errorUrl);
  }

  if (!params.code || !params.state) {
    throw new OAuthError("Missing code or state", errorUrl);
  }

  const validatedState = await dependencies.validateState(params.state);
  if (!validatedState) {
    throw new OAuthError("Invalid or expired state", errorUrl);
  }

  const { userId, destinationId } = validatedState;

  const callbackUrl = new URL(`/api/destinations/callback/${params.provider}`, dependencies.baseUrl);
  const tokens = await dependencies.exchangeCodeForTokens(
    params.provider,
    params.code,
    callbackUrl.toString(),
  );

  if (!tokens.refresh_token) {
    throw new OAuthError("No refresh token", errorUrl);
  }

  const userInfo = await dependencies.fetchUserInfo(params.provider, tokens.access_token);
  const expiresAt = new Date(Date.now() + tokens.expires_in * MS_PER_SECOND);

  if (destinationId) {
    const existingAccountId = await dependencies.getDestinationAccountId(userId, destinationId);
    if (existingAccountId && existingAccountId !== userInfo.id) {
      const reauthUrl = new URL("/dashboard/integrations", dependencies.baseUrl);
      reauthUrl.searchParams.set(
        "error",
        "Please reauthenticate with the same account that was originally connected.",
      );
      throw new OAuthError("Please reauthenticate with the same account", reauthUrl);
    }
  }

  const needsReauthentication = !(await dependencies.hasRequiredScopes(params.provider, tokens.scope));
  const destinationPayload: { destinationId?: string } = {};
  if (destinationId !== null) {
    destinationPayload.destinationId = destinationId;
  }

  await dependencies.persistCalendarDestination({
    accountId: userInfo.id,
    accessToken: tokens.access_token,
    ...destinationPayload,
    email: userInfo.email,
    expiresAt,
    needsReauthentication,
    provider: params.provider,
    refreshToken: tokens.refresh_token,
    userId,
  });

  dependencies.triggerDestinationSync(userId);

  return { redirectUrl: successUrl, userId };
};

const handleOAuthCallback = async (
  params: OAuthCallbackParams,
): Promise<{ userId: string; redirectUrl: URL }> => {
  const [{ baseUrl, database, premiumService }, destinationsModule, syncModule] = await Promise.all([
    import("../context"),
    import("./destinations"),
    import("./sync"),
  ]);

  const persistCalendarDestination = async (payload: {
    accountId: string;
    accessToken: string;
    destinationId?: string;
    email: string | null;
    expiresAt: Date;
    needsReauthentication: boolean;
    provider: string;
    refreshToken: string;
    userId: string;
  }): Promise<void> => {
    await database.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${USER_ACCOUNT_LOCK_NAMESPACE}, hashtext(${payload.userId}))`,
      );

      if (!payload.destinationId) {
        const existingAccount = await getExistingDestinationAccount(tx, payload.provider, payload.accountId);
        if (!existingAccount) {
          const accounts = await tx
            .select({ id: calendarAccountsTable.id })
            .from(calendarAccountsTable)
            .where(eq(calendarAccountsTable.userId, payload.userId));

          const allowed = await premiumService.canAddAccount(payload.userId, accounts.length);
          if (!allowed) {
            throw new OAuthError(
              "Account limit reached",
              buildRedirectUrl("/dashboard/integrations", baseUrl, {
                destination: "error",
                error: ACCOUNT_LIMIT_ERROR_MESSAGE,
              }),
            );
          }
        }
      }

      await destinationsModule.saveCalendarDestinationWithDatabase(
        tx,
        payload.userId,
        payload.provider,
        payload.accountId,
        payload.email,
        payload.accessToken,
        payload.refreshToken,
        payload.expiresAt,
        payload.needsReauthentication,
      );
    });
  };

  return handleOAuthCallbackWithDependencies(params, {
    baseUrl,
    exchangeCodeForTokens: destinationsModule.exchangeCodeForTokens,
    fetchUserInfo: destinationsModule.fetchUserInfo,
    getDestinationAccountId: destinationsModule.getDestinationAccountId,
    hasRequiredScopes: destinationsModule.hasRequiredScopes,
    persistCalendarDestination,
    triggerDestinationSync: syncModule.triggerDestinationSync,
    validateState: destinationsModule.validateState,
  });
};

export {
  parseOAuthCallback,
  buildRedirectUrl,
  handleOAuthCallback,
  handleOAuthCallbackWithDependencies,
  OAuthError,
};
