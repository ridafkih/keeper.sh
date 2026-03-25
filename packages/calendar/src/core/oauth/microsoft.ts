import { microsoftTokenResponseSchema, microsoftUserInfoSchema } from "@keeper.sh/data-schemas";
import type { MicrosoftTokenResponse, MicrosoftUserInfo } from "@keeper.sh/data-schemas";
import { generateState, validateState } from "./state";
import type { ValidatedState, OAuthStateStore } from "./state";

const MICROSOFT_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MICROSOFT_USERINFO_URL = "https://graph.microsoft.com/v1.0/me";

const MICROSOFT_CALENDAR_SCOPE = "Calendars.ReadWrite";
const MICROSOFT_USER_SCOPE = "User.Read";
const MICROSOFT_OFFLINE_SCOPE = "offline_access";
const REQUEST_TIMEOUT_MS = 15_000;

const isRequestTimeoutError = (error: unknown): boolean =>
  error instanceof Error
  && (error.name === "AbortError" || error.name === "TimeoutError");

interface MicrosoftOAuthCredentials {
  clientId: string;
  clientSecret: string;
}

interface AuthorizationUrlOptions {
  callbackUrl: string;
  scopes?: string[];
  destinationId?: string;
  sourceCredentialId?: string;
}

interface MicrosoftOAuthService {
  getAuthorizationUrl: (userId: string, options: AuthorizationUrlOptions) => Promise<string>;
  exchangeCodeForTokens: (code: string, callbackUrl: string) => Promise<MicrosoftTokenResponse>;
  refreshAccessToken: (refreshToken: string) => Promise<MicrosoftTokenResponse>;
}

const createMicrosoftOAuthService = (
  credentials: MicrosoftOAuthCredentials,
  stateStore: OAuthStateStore,
): MicrosoftOAuthService => {
  const { clientId, clientSecret } = credentials;

  const getAuthorizationUrl = async (userId: string, options: AuthorizationUrlOptions): Promise<string> => {
    const state = await generateState(stateStore, userId, {
      destinationId: options.destinationId,
      sourceCredentialId: options.sourceCredentialId,
    });
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
    return microsoftTokenResponseSchema.assert(body);
  };

  const refreshAccessToken = async (refreshToken: string): Promise<MicrosoftTokenResponse> => {
    const response = await fetch(MICROSOFT_TOKEN_URL, {
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).catch((error) => {
      if (isRequestTimeoutError(error)) {
        throw new Error(`Token refresh timed out after ${REQUEST_TIMEOUT_MS}ms`);
      }

      throw error;
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed (${response.status}): ${error}`);
    }

    const body = await response.json();
    return microsoftTokenResponseSchema.assert(body);
  };

  return {
    exchangeCodeForTokens,
    getAuthorizationUrl,
    refreshAccessToken,
  };
};

const fetchUserInfo = async (accessToken: string): Promise<MicrosoftUserInfo> => {
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
const hasRequiredScopes = (grantedScopes: string): boolean => {
  const scopes = grantedScopes.toLowerCase().split(" ");
  return scopes.includes(MICROSOFT_CALENDAR_SCOPE.toLowerCase());
};

export {
  MICROSOFT_CALENDAR_SCOPE,
  MICROSOFT_USER_SCOPE,
  MICROSOFT_OFFLINE_SCOPE,
  createMicrosoftOAuthService,
  fetchUserInfo,
  hasRequiredScopes,
  validateState,
};
export type {
  ValidatedState,
  MicrosoftOAuthCredentials,
  AuthorizationUrlOptions,
  MicrosoftOAuthService,
  MicrosoftTokenResponse,
  MicrosoftUserInfo,
};
