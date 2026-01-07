import {
  exchangeCodeForTokens,
  fetchUserInfo,
  getDestinationAccountId,
  hasRequiredScopes,
  saveCalendarDestination,
  validateState,
} from "./destinations";
import { triggerDestinationSync } from "./sync";
import { baseUrl } from "../context";

const MS_PER_SECOND = 1000;

interface OAuthCallbackParams {
  code: string | null;
  state: string | null;
  error: string | null;
  provider: string;
}

/**
 * Parses OAuth callback parameters from a request.
 */
const parseOAuthCallback = (request: Request, provider: string): OAuthCallbackParams => {
  const url = new URL(request.url);
  return {
    code: url.searchParams.get("code"),
    error: url.searchParams.get("error"),
    provider,
    state: url.searchParams.get("state"),
  };
};

/**
 * Builds a redirect URL with optional parameters.
 */
const buildRedirectUrl = (path: string, params?: Record<string, string>): URL => {
  const url = new URL(path, baseUrl);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return url;
};

/**
 * Error class for OAuth failures that includes a redirect URL.
 */
class OAuthError extends Error {
  constructor(
    message: string,
    public redirectUrl: URL,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

/**
 * Handles a successful OAuth callback - exchanges code for tokens and saves destination.
 * Returns the userId if successful.
 * Throws if validation fails or tokens are missing.
 */
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
