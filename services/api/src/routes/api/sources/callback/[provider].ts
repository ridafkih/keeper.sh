import { withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { widelog } from "@/utils/logging";
import { labelFailure } from "@/utils/error-labelling";
import { buildRedirectUrl, OAuthError } from "@/utils/oauth";
import { oauthCallbackQuerySchema, providerParamSchema } from "@/utils/request-query";
import {
  exchangeCodeForTokens,
  fetchUserInfo,
  validateState,
} from "@/utils/destinations";
import {
  createOAuthSourceCredential,
  deleteOAuthSourceCredential,
} from "@/utils/oauth-source-credentials";
import { importOAuthAccountCalendars } from "@/utils/oauth-sources";
import { openConnectDeadline } from "@/utils/connect-deadline";
import { SERVER_IDLE_TIMEOUT_SECONDS } from "@keeper.sh/constants";
import { baseUrl } from "@/context";

const MS_PER_SECOND = 1000;
const CONNECT_BUDGET_SHARE_OF_IDLE_TIMEOUT = 0.6;
const OAUTH_CALLBACK_CONNECT_BUDGET_MS = Math.floor(
  SERVER_IDLE_TIMEOUT_SECONDS * MS_PER_SECOND * CONNECT_BUDGET_SHARE_OF_IDLE_TIMEOUT,
);

interface ConnectOAuthAccountOptions {
  accessToken: string;
  email: string | null;
  expiresAt: Date;
  provider: string;
  providerAccountId: string;
  refreshToken: string;
  signal: AbortSignal;
  userId: string;
}

const discardCreatedCredential = async (
  userId: string,
  credentialId: string,
): Promise<void> => {
  try {
    await deleteOAuthSourceCredential(userId, credentialId);
  } catch (error) {
    widelog.errorFields(error, { slug: "oauth-callback-credential-discard-failed" });
  }
};

const connectOAuthAccount = async ({
  accessToken,
  email,
  expiresAt,
  provider,
  providerAccountId,
  refreshToken,
  signal,
  userId,
}: ConnectOAuthAccountOptions): Promise<string> => {
  let createdCredentialId: string | null = null;

  const credentialId = await createOAuthSourceCredential(
    userId,
    { accessToken, email, expiresAt, provider, refreshToken },
    {
      onCredentialCreated: (id: string) => {
        createdCredentialId = id;
      },
    },
  );

  try {
    return await importOAuthAccountCalendars({
      accessToken,
      email,
      oauthCredentialId: credentialId,
      provider,
      providerAccountId,
      signal,
      userId,
    });
  } catch (error) {
    if (createdCredentialId !== null) {
      await discardCreatedCredential(userId, createdCredentialId);
    }

    throw error;
  }
};

const GET = withWideEvent(async ({ request, params }) => {
  if (!params.provider || !providerParamSchema.allows(params)) {
    return ErrorResponse.notFound().toResponse();
  }

  widelog.set("provider.name", params.provider);

  const { provider } = params;

  const errorUrl = buildRedirectUrl("/dashboard/integrations", baseUrl, {
    error: "Failed to connect source",
    source: "error",
  });

  try {
    const url = new URL(request.url);
    const callbackQuery = Object.fromEntries(url.searchParams.entries());
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (!oauthCallbackQuerySchema.allows(callbackQuery)) {
      throw new OAuthError("Invalid callback query parameters", errorUrl);
    }

    if (error) {
      throw new OAuthError("OAuth error from provider", errorUrl);
    }

    if (!code || !state) {
      throw new OAuthError("Missing code or state", errorUrl);
    }

    const deadline = openConnectDeadline(OAUTH_CALLBACK_CONNECT_BUDGET_MS);

    const validatedState = await validateState(state);
    if (!validatedState) {
      throw new OAuthError("Invalid or expired state", errorUrl);
    }

    const { userId } = validatedState;

    const callbackUrl = new URL(`/api/sources/callback/${provider}`, baseUrl);
    const tokens = await exchangeCodeForTokens(provider, code, callbackUrl.toString(), {
      signal: deadline.signal,
    });

    if (!tokens.refresh_token) {
      throw new OAuthError("No refresh token", errorUrl);
    }

    const userInfo = await fetchUserInfo(provider, tokens.access_token, {
      signal: deadline.signal,
    });
    const expiresAt = new Date(Date.now() + tokens.expires_in * MS_PER_SECOND);

    const accountId = await connectOAuthAccount({
      accessToken: tokens.access_token,
      email: userInfo.email,
      expiresAt,
      provider,
      providerAccountId: userInfo.id,
      refreshToken: tokens.refresh_token,
      signal: deadline.signal,
      userId,
    });

    const successUrl = buildRedirectUrl(`/dashboard/accounts/${accountId}/setup`, baseUrl);
    return Response.redirect(successUrl.toString());
  } catch (error) {
    if (error instanceof OAuthError) {
      widelog.errorFields(error, { slug: "oauth-callback-failed" });
      return Response.redirect(error.redirectUrl.toString());
    }

    labelFailure(error, { slug: "unclassified" });
    return Response.redirect(errorUrl.toString());
  }
});

export { GET, OAUTH_CALLBACK_CONNECT_BUDGET_MS };
