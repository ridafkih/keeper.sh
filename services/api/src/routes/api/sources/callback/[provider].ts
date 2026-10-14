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
import { createOAuthSourceCredential } from "@/utils/oauth-source-credentials";
import { importOAuthAccountCalendars } from "@/utils/oauth-sources";
import { baseUrl } from "@/context";
import type { OAuthReturnTo } from "@keeper.sh/calendar";

const MS_PER_SECOND = 1000;

const RETURN_TO_PATHS: Record<OAuthReturnTo, { path: string; params: Record<string, string> }> = {
  onboarding: { params: { step: "connect" }, path: "/onboarding" },
};

const returnToUrl = (returnTo: OAuthReturnTo, params: Record<string, string>): URL => {
  const target = RETURN_TO_PATHS[returnTo];
  return buildRedirectUrl(target.path, baseUrl, { ...target.params, ...params });
};

const GET = withWideEvent(async ({ request, params }) => {
  if (!params.provider || !providerParamSchema.allows(params)) {
    return ErrorResponse.notFound().toResponse();
  }

  widelog.set("provider.name", params.provider);

  const { provider } = params;

  let errorUrl = buildRedirectUrl("/dashboard/integrations", baseUrl, {
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

    // The state is read before the provider's error, so someone who cancels still lands where they started.
    let validatedState: Awaited<ReturnType<typeof validateState>> = null;
    if (state) {
      validatedState = await validateState(state);
    }
    if (validatedState?.returnTo) {
      errorUrl = returnToUrl(validatedState.returnTo, { error: "connect_failed" });
    }

    if (error) {
      throw new OAuthError("OAuth error from provider", errorUrl);
    }

    if (!code || !validatedState) {
      throw new OAuthError("Missing code or invalid state", errorUrl);
    }

    const { userId, sourceCredentialId, returnTo } = validatedState;

    const callbackUrl = new URL(`/api/sources/callback/${provider}`, baseUrl);
    const tokens = await exchangeCodeForTokens(provider, code, callbackUrl.toString());

    if (!tokens.refresh_token) {
      throw new OAuthError("No refresh token", errorUrl);
    }

    const userInfo = await fetchUserInfo(provider, tokens.access_token);
    const expiresAt = new Date(Date.now() + tokens.expires_in * MS_PER_SECOND);

    const credentialId = await createOAuthSourceCredential(userId, {
      accessToken: tokens.access_token,
      email: userInfo.email,
      expiresAt,
      provider,
      refreshToken: tokens.refresh_token,
    });

    const accountId = await importOAuthAccountCalendars({
      accessToken: tokens.access_token,
      email: userInfo.email,
      oauthCredentialId: credentialId,
      provider,
      providerAccountId: userInfo.id,
      userId,
    });

    /* A reconnect already has its calendars chosen, so only a first connection — which
       carries no source credential in its state — belongs in the setup sentence. */
    let successUrl = buildRedirectUrl("/dashboard/setup", baseUrl, { accountId });
    if (sourceCredentialId) {
      successUrl = buildRedirectUrl(`/dashboard/accounts/${accountId}`, baseUrl);
    } else if (returnTo) {
      successUrl = returnToUrl(returnTo, { accountId });
    }
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

export { GET };
