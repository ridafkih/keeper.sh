import { withWideEvent } from "../../../../utils/middleware";
import { ErrorResponse } from "../../../../utils/responses";
import { buildRedirectUrl, OAuthError } from "../../../../utils/oauth";
import { exchangeCodeForTokens, fetchUserInfo, validateState } from "../../../../utils/destinations";
import { createOAuthSourceCredential } from "../../../../utils/oauth-source-credentials";
import { baseUrl } from "../../../../context";

const MS_PER_SECOND = 1000;

const GET = withWideEvent(async ({ request, params }) => {
  const { provider } = params;

  if (!provider) {
    return ErrorResponse.notFound().toResponse();
  }

  const successBaseUrl = "/dashboard/integrations";
  const errorUrl = buildRedirectUrl("/dashboard/integrations", {
    error: "Failed to connect source",
    source: "error",
  });

  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      throw new OAuthError("OAuth error from provider", errorUrl);
    }

    if (!code || !state) {
      throw new OAuthError("Missing code or state", errorUrl);
    }

    const validatedState = validateState(state);
    if (!validatedState) {
      throw new OAuthError("Invalid or expired state", errorUrl);
    }

    const { userId } = validatedState;

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

    const successUrl = buildRedirectUrl(successBaseUrl, {
      provider,
      source: "connected",
      sourceCredentialId: credentialId,
    });

    return Response.redirect(successUrl.toString());
  } catch (error) {
    if (error instanceof OAuthError) {
      return Response.redirect(error.redirectUrl.toString());
    }

    return Response.redirect(errorUrl.toString());
  }
});

export { GET };
