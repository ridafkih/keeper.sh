import { googleTokenResponseSchema, googleUserInfoSchema } from "@keeper.sh/data-schemas";
import type { GoogleTokenResponse, GoogleUserInfo } from "@keeper.sh/data-schemas";
import { generateState, validateState } from "@keeper.sh/oauth";
import type { ValidatedState } from "@keeper.sh/oauth";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const GOOGLE_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";

interface GoogleOAuthCredentials {
  clientId: string;
  clientSecret: string;
}

interface AuthorizationUrlOptions {
  callbackUrl: string;
  scopes?: string[];
  destinationId?: string;
}

interface GoogleOAuthService {
  getAuthorizationUrl: (userId: string, options: AuthorizationUrlOptions) => string;
  exchangeCodeForTokens: (code: string, callbackUrl: string) => Promise<GoogleTokenResponse>;
  refreshAccessToken: (refreshToken: string) => Promise<GoogleTokenResponse>;
}

const createGoogleOAuthService = (credentials: GoogleOAuthCredentials): GoogleOAuthService => {
  const { clientId, clientSecret } = credentials;

  const getAuthorizationUrl = (userId: string, options: AuthorizationUrlOptions): string => {
    const state = generateState(userId, options.destinationId);
    const scopes = options.scopes ?? [GOOGLE_CALENDAR_SCOPE, GOOGLE_EMAIL_SCOPE];

    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", options.callbackUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scopes.join(" "));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);

    return url.toString();
  };

  const exchangeCodeForTokens = async (
    code: string,
    callbackUrl: string,
  ): Promise<GoogleTokenResponse> => {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: callbackUrl,
      }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed (${response.status}): ${error}`);
    }

    const body = await response.json();
    return googleTokenResponseSchema.assert(body);
  };

  const refreshAccessToken = async (refreshToken: string): Promise<GoogleTokenResponse> => {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed (${response.status}): ${error}`);
    }

    const body = await response.json();
    return googleTokenResponseSchema.assert(body);
  };

  return {
    exchangeCodeForTokens,
    getAuthorizationUrl,
    refreshAccessToken,
  };
};

const fetchUserInfo = async (accessToken: string): Promise<GoogleUserInfo> => {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch user info: ${response.status}`);
  }

  const body = await response.json();
  return googleUserInfoSchema.assert(body);
};

/**
 * Checks if the granted scopes include all required scopes for calendar operations.
 * Google returns scopes as a space-separated string.
 */
const hasRequiredScopes = (grantedScopes: string): boolean => {
  const scopes = grantedScopes.split(" ");
  return scopes.includes(GOOGLE_CALENDAR_SCOPE);
};

export {
  generateState,
  validateState,
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_EMAIL_SCOPE,
  createGoogleOAuthService,
  fetchUserInfo,
  hasRequiredScopes,
};
export type {
  ValidatedState,
  GoogleOAuthCredentials,
  AuthorizationUrlOptions,
  GoogleOAuthService,
  GoogleTokenResponse,
  GoogleUserInfo,
};
