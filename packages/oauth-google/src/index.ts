import {
  googleTokenResponseSchema,
  googleUserInfoSchema,
  type GoogleTokenResponse,
  type GoogleUserInfo,
} from "@keeper.sh/data-schemas";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

export const GOOGLE_CALENDAR_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";
export const GOOGLE_EMAIL_SCOPE =
  "https://www.googleapis.com/auth/userinfo.email";

interface PendingState {
  userId: string;
  destinationId: string | null;
  expiresAt: number;
}

export interface ValidatedState {
  userId: string;
  destinationId: string | null;
}

const pendingStates = new Map<string, PendingState>();

export const generateState = (userId: string, destinationId?: string): string => {
  const state = crypto.randomUUID();
  const expiresAt = Date.now() + 10 * 60 * 1000;
  pendingStates.set(state, { userId, destinationId: destinationId ?? null, expiresAt });
  return state;
};

export const validateState = (state: string): ValidatedState | null => {
  const entry = pendingStates.get(state);
  if (!entry) return null;

  pendingStates.delete(state);

  if (Date.now() > entry.expiresAt) return null;

  return { userId: entry.userId, destinationId: entry.destinationId };
};

export interface GoogleOAuthCredentials {
  clientId: string;
  clientSecret: string;
}

export interface AuthorizationUrlOptions {
  callbackUrl: string;
  scopes?: string[];
  destinationId?: string;
}

export interface GoogleOAuthService {
  getAuthorizationUrl: (userId: string, options: AuthorizationUrlOptions) => string;
  exchangeCodeForTokens: (code: string, callbackUrl: string) => Promise<GoogleTokenResponse>;
  refreshAccessToken: (refreshToken: string) => Promise<GoogleTokenResponse>;
}

export const createGoogleOAuthService = (
  credentials: GoogleOAuthCredentials,
): GoogleOAuthService => {
  const { clientId, clientSecret } = credentials;

  const getAuthorizationUrl = (
    userId: string,
    options: AuthorizationUrlOptions,
  ): string => {
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
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: callbackUrl,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed (${response.status}): ${error}`);
    }

    const body = await response.json();
    return googleTokenResponseSchema.assert(body);
  };

  const refreshAccessToken = async (
    refreshToken: string,
  ): Promise<GoogleTokenResponse> => {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed (${response.status}): ${error}`);
    }

    const body = await response.json();
    return googleTokenResponseSchema.assert(body);
  };

  return {
    getAuthorizationUrl,
    exchangeCodeForTokens,
    refreshAccessToken,
  };
};

export const fetchUserInfo = async (
  accessToken: string,
): Promise<GoogleUserInfo> => {
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
export const hasRequiredScopes = (grantedScopes: string): boolean => {
  const scopes = grantedScopes.split(" ");
  return scopes.includes(GOOGLE_CALENDAR_SCOPE);
};

export type { GoogleTokenResponse, GoogleUserInfo };
