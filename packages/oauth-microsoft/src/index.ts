import {
  microsoftTokenResponseSchema,
  microsoftUserInfoSchema,
  type MicrosoftTokenResponse,
  type MicrosoftUserInfo,
} from "@keeper.sh/data-schemas";

const MICROSOFT_AUTH_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MICROSOFT_TOKEN_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MICROSOFT_USERINFO_URL = "https://graph.microsoft.com/v1.0/me";

export const MICROSOFT_CALENDAR_SCOPE = "Calendars.ReadWrite";
export const MICROSOFT_USER_SCOPE = "User.Read";
export const MICROSOFT_OFFLINE_SCOPE = "offline_access";

const pendingStates = new Map<string, { userId: string; expiresAt: number }>();

export const generateState = (userId: string): string => {
  const state = crypto.randomUUID();
  const expiresAt = Date.now() + 10 * 60 * 1000;
  pendingStates.set(state, { userId, expiresAt });
  return state;
};

export const validateState = (state: string): string | null => {
  const entry = pendingStates.get(state);
  if (!entry) return null;

  pendingStates.delete(state);

  if (Date.now() > entry.expiresAt) return null;

  return entry.userId;
};

export interface MicrosoftOAuthCredentials {
  clientId: string;
  clientSecret: string;
}

export interface AuthorizationUrlOptions {
  callbackUrl: string;
  scopes?: string[];
}

export interface MicrosoftOAuthService {
  getAuthorizationUrl: (userId: string, options: AuthorizationUrlOptions) => string;
  exchangeCodeForTokens: (code: string, callbackUrl: string) => Promise<MicrosoftTokenResponse>;
  refreshAccessToken: (refreshToken: string) => Promise<MicrosoftTokenResponse>;
}

export const createMicrosoftOAuthService = (
  credentials: MicrosoftOAuthCredentials,
): MicrosoftOAuthService => {
  const { clientId, clientSecret } = credentials;

  const getAuthorizationUrl = (
    userId: string,
    options: AuthorizationUrlOptions,
  ): string => {
    const state = generateState(userId);
    const scopes = options.scopes ?? [
      MICROSOFT_CALENDAR_SCOPE,
      MICROSOFT_USER_SCOPE,
      MICROSOFT_OFFLINE_SCOPE,
    ];

    const url = new URL(MICROSOFT_AUTH_URL);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", options.callbackUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scopes.join(" "));
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);

    return url.toString();
  };

  const exchangeCodeForTokens = async (
    code: string,
    callbackUrl: string,
  ): Promise<MicrosoftTokenResponse> => {
    const response = await fetch(MICROSOFT_TOKEN_URL, {
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
    return microsoftTokenResponseSchema.assert(body);
  };

  const refreshAccessToken = async (
    refreshToken: string,
  ): Promise<MicrosoftTokenResponse> => {
    const response = await fetch(MICROSOFT_TOKEN_URL, {
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
    return microsoftTokenResponseSchema.assert(body);
  };

  return {
    getAuthorizationUrl,
    exchangeCodeForTokens,
    refreshAccessToken,
  };
};

export const fetchUserInfo = async (
  accessToken: string,
): Promise<MicrosoftUserInfo> => {
  const response = await fetch(MICROSOFT_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch user info: ${response.status}`);
  }

  const body = await response.json();
  return microsoftUserInfoSchema.assert(body);
};

/**
 * Checks if the granted scopes include all required scopes for calendar operations.
 * Microsoft returns scopes as a space-separated string.
 */
export const hasRequiredScopes = (grantedScopes: string): boolean => {
  const scopes = grantedScopes.toLowerCase().split(" ");
  return scopes.includes(MICROSOFT_CALENDAR_SCOPE.toLowerCase());
};

export type { MicrosoftTokenResponse, MicrosoftUserInfo };
