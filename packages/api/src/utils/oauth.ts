import { log } from "@keeper.sh/log";
import {
  exchangeCodeForTokens,
  fetchUserInfo,
  saveCalendarDestination,
  validateState,
  hasRequiredScopes,
  getDestinationAccountId,
} from "./destinations";
import { triggerDestinationSync } from "./sync";
import { baseUrl } from "../context";

interface OAuthCallbackParams {
  code: string | null;
  state: string | null;
  error: string | null;
  provider: string;
}

/**
 * Parses OAuth callback parameters from a request.
 */
export const parseOAuthCallback = (
  request: Request,
  provider: string,
): OAuthCallbackParams => {
  const url = new URL(request.url);
  return {
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state"),
    error: url.searchParams.get("error"),
    provider,
  };
};

/**
 * Builds a redirect URL with optional parameters.
 */
export const buildRedirectUrl = (
  path: string,
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

/**
 * Handles a successful OAuth callback - exchanges code for tokens and saves destination.
 * Returns the userId if successful.
 * Throws if validation fails or tokens are missing.
 */
export const handleOAuthCallback = async (
  params: OAuthCallbackParams,
): Promise<{ userId: string; redirectUrl: URL }> => {
  const successUrl = buildRedirectUrl("/dashboard/integrations", {
    destination: "connected",
  });
  const errorUrl = buildRedirectUrl("/dashboard/integrations", {
    destination: "error",
  });

  if (!params.provider) {
    log.warn("Missing provider in callback URL");
    throw new OAuthError("Missing provider", errorUrl);
  }

  if (params.error) {
    log.warn({ error: params.error }, "OAuth error returned from provider");
    throw new OAuthError("OAuth error from provider", errorUrl);
  }

  if (!params.code || !params.state) {
    log.warn("Missing code or state in callback");
    throw new OAuthError("Missing code or state", errorUrl);
  }

  const validatedState = validateState(params.state);
  if (!validatedState) {
    log.warn("Invalid or expired state");
    throw new OAuthError("Invalid or expired state", errorUrl);
  }

  const { userId, destinationId } = validatedState;

  const callbackUrl = new URL(
    `/api/destinations/callback/${params.provider}`,
    baseUrl,
  );
  const tokens = await exchangeCodeForTokens(
    params.provider,
    params.code,
    callbackUrl.toString(),
  );

  if (!tokens.refresh_token) {
    log.error("No refresh token in response");
    throw new OAuthError("No refresh token", errorUrl);
  }

  const userInfo = await fetchUserInfo(params.provider, tokens.access_token);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  if (destinationId) {
    const existingAccountId = await getDestinationAccountId(destinationId);
    if (existingAccountId && existingAccountId !== userInfo.id) {
      log.warn(
        { userId, destinationId, expectedAccountId: existingAccountId, actualAccountId: userInfo.id },
        "reauthentication attempted with different account",
      );
      throw new OAuthError(
        "Please reauthenticate with the same account",
        buildRedirectUrl("/dashboard/integrations", {
          error: "Please reauthenticate with the same account that was originally connected.",
        }),
      );
    }
  }

  const needsReauthentication = !hasRequiredScopes(params.provider, tokens.scope);

  if (needsReauthentication) {
    log.warn(
      { userId, provider: params.provider, grantedScopes: tokens.scope },
      "user did not grant required scopes",
    );
  }

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

  log.info(
    { userId, provider: params.provider, needsReauthentication },
    "calendar destination connected",
  );

  triggerDestinationSync(userId);

  return { userId, redirectUrl: successUrl };
};

/**
 * Error class for OAuth failures that includes a redirect URL.
 */
export class OAuthError extends Error {
  constructor(
    message: string,
    public redirectUrl: URL,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}
