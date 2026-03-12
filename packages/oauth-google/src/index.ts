import { googleTokenResponseSchema, googleUserInfoSchema } from "@keeper.sh/data-schemas";
import type { GoogleTokenResponse, GoogleUserInfo } from "@keeper.sh/data-schemas";
import { generateState, validateState, configureStateStore } from "@keeper.sh/oauth";
import type { ValidatedState, OAuthStateStore } from "@keeper.sh/oauth";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const GOOGLE_CALENDAR_LIST_SCOPE = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
const GOOGLE_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";
const REQUEST_TIMEOUT_MS = 15_000;
const REFRESH_MAX_ATTEMPTS = 2;

const isRequestTimeoutError = (error: unknown): boolean =>
  error instanceof Error
  && (error.name === "AbortError" || error.name === "TimeoutError");

interface GoogleOAuthCredentials {
  clientId: string;
  clientSecret: string;
}

interface AuthorizationUrlOptions {
  callbackUrl: string;
  scopes?: string[];
  destinationId?: string;
  sourceCredentialId?: string;
}

interface GoogleOAuthService {
  getAuthorizationUrl: (userId: string, options: AuthorizationUrlOptions) => Promise<string>;
  exchangeCodeForTokens: (code: string, callbackUrl: string) => Promise<GoogleTokenResponse>;
  refreshAccessToken: (refreshToken: string) => Promise<GoogleTokenResponse>;
}

interface GoogleTokenErrorPayload {
  error?: string;
  error_description?: string;
  error_subtype?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readOptionalString = (
  value: Record<string, unknown>,
  key: string,
): string | undefined => {
  const entry = value[key];
  if (typeof entry !== "string") {
    return;
  }
  return entry;
};

class GoogleOAuthRefreshError extends Error {
  readonly status: number | null;
  readonly oauthErrorCode?: string;
  readonly oauthErrorSubtype?: string;
  readonly oauthReauthRequired: boolean;
  readonly oauthRetriable: boolean;

  constructor(
    message: string,
    options: {
      status: number | null;
      oauthErrorCode?: string;
      oauthErrorSubtype?: string;
      oauthReauthRequired: boolean;
      oauthRetriable: boolean;
    },
  ) {
    super(message);
    this.name = "GoogleOAuthRefreshError";
    this.status = options.status;
    this.oauthErrorCode = options.oauthErrorCode;
    this.oauthErrorSubtype = options.oauthErrorSubtype;
    this.oauthReauthRequired = options.oauthReauthRequired;
    this.oauthRetriable = options.oauthRetriable;
  }
}

const isRetriableStatusCode = (status: number): boolean => status === 429 || status >= 500;

const parseGoogleTokenErrorPayload = (value: string): GoogleTokenErrorPayload | null => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) {
      return null;
    }

    const error = readOptionalString(parsed, "error");
    const errorDescription = readOptionalString(parsed, "error_description");
    const errorSubtype = readOptionalString(parsed, "error_subtype");

    return {
      ...(error && { error }),
      ...(errorDescription && { error_description: errorDescription }),
      ...(errorSubtype && { error_subtype: errorSubtype }),
    };
  } catch {
    return null;
  }
};

const getRefreshErrorCode = (
  payload: GoogleTokenErrorPayload | null,
): string | undefined => payload?.error?.toLowerCase();

const createGoogleOAuthService = (credentials: GoogleOAuthCredentials): GoogleOAuthService => {
  const { clientId, clientSecret } = credentials;

  const getAuthorizationUrl = async (userId: string, options: AuthorizationUrlOptions): Promise<string> => {
    const state = await generateState(userId, {
      destinationId: options.destinationId,
      sourceCredentialId: options.sourceCredentialId,
    });
    const scopes = options.scopes ?? [
      GOOGLE_CALENDAR_SCOPE,
      GOOGLE_CALENDAR_LIST_SCOPE,
      GOOGLE_EMAIL_SCOPE,
    ];

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
    for (let attempt = 1; attempt <= REFRESH_MAX_ATTEMPTS; attempt++) {
      const response = await fetch(GOOGLE_TOKEN_URL, {
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
          const timeoutError = new GoogleOAuthRefreshError(
            `Token refresh timed out after ${REQUEST_TIMEOUT_MS}ms`,
            {
              oauthReauthRequired: false,
              oauthRetriable: true,
              status: null,
            },
          );

          if (attempt < REFRESH_MAX_ATTEMPTS) {
            return timeoutError;
          }

          throw timeoutError;
        }

        if (attempt < REFRESH_MAX_ATTEMPTS) {
          return error;
        }

        throw error;
      });

      if (response instanceof GoogleOAuthRefreshError) {
        continue;
      }

      if (response instanceof Error) {
        continue;
      }

      if (!response.ok) {
        const rawError = await response.text();
        const parsedError = parseGoogleTokenErrorPayload(rawError);
        const oauthErrorCode = getRefreshErrorCode(parsedError);
        const oauthErrorSubtype = parsedError?.error_subtype;
        const oauthReauthRequired = response.status === 400 && oauthErrorCode === "invalid_grant";
        const oauthRetriable = isRetriableStatusCode(response.status);
        const refreshError = new GoogleOAuthRefreshError(
          `Token refresh failed (${response.status}): ${rawError}`,
          {
            oauthErrorCode,
            oauthErrorSubtype,
            oauthReauthRequired,
            oauthRetriable,
            status: response.status,
          },
        );

        if (refreshError.oauthRetriable && attempt < REFRESH_MAX_ATTEMPTS) {
          continue;
        }

        throw refreshError;
      }

      const body = await response.json();
      return googleTokenResponseSchema.assert(body);
    }

    throw new GoogleOAuthRefreshError(
      "Token refresh failed after retry attempts",
      {
        oauthReauthRequired: false,
        oauthRetriable: false,
        status: null,
      },
    );
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
  configureStateStore,
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_CALENDAR_LIST_SCOPE,
  GOOGLE_EMAIL_SCOPE,
  createGoogleOAuthService,
  fetchUserInfo,
  hasRequiredScopes,
};
export type {
  ValidatedState,
  OAuthStateStore,
  GoogleOAuthCredentials,
  AuthorizationUrlOptions,
  GoogleOAuthService,
  GoogleTokenResponse,
  GoogleUserInfo,
};
