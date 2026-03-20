import {
  createGoogleOAuthService,
  createMicrosoftOAuthService,
  createRedisRateLimiter,
} from "@keeper.sh/calendar";
import type {
  IngestionFetchEventsResult,
  OAuthRefreshResult,
  RedisRateLimiter,
} from "@keeper.sh/calendar";
import { createGoogleSourceFetcher } from "@keeper.sh/calendar/google";
import { createOutlookSourceFetcher } from "@keeper.sh/calendar/outlook";
import type Redis from "ioredis";

const OAUTH_INGESTION_PROVIDER_NAMES = ["google", "outlook"] as const;
type OAuthIngestionProviderName = (typeof OAUTH_INGESTION_PROVIDER_NAMES)[number];

const OAuthIngestionResolutionStatus = {
  MISCONFIGURED_PROVIDER: "MISCONFIGURED_PROVIDER",
  MISSING_PROVIDER_CREDENTIALS: "MISSING_PROVIDER_CREDENTIALS",
  RESOLVED: "RESOLVED",
  UNSUPPORTED_PROVIDER: "UNSUPPORTED_PROVIDER",
} as const;

type OAuthIngestionResolutionStatus =
  (typeof OAuthIngestionResolutionStatus)[keyof typeof OAuthIngestionResolutionStatus];

interface OAuthIngestionConfig {
  googleClientId?: string;
  googleClientSecret?: string;
  microsoftClientId?: string;
  microsoftClientSecret?: string;
}

interface OAuthIngestionResolutionInput {
  accessToken: string;
  externalCalendarId: string | null;
  oauthConfig: OAuthIngestionConfig;
  provider: string;
  syncToken: string | null;
  userId: string;
}

interface OAuthFetcher {
  fetchEvents: () => Promise<IngestionFetchEventsResult>;
}

type TokenRefresher = (refreshToken: string) => Promise<OAuthRefreshResult>;

type OAuthIngestionResolution =
  | { status: typeof OAuthIngestionResolutionStatus.UNSUPPORTED_PROVIDER }
  | { status: typeof OAuthIngestionResolutionStatus.MISSING_PROVIDER_CREDENTIALS }
  | { status: typeof OAuthIngestionResolutionStatus.MISCONFIGURED_PROVIDER }
  | {
    status: typeof OAuthIngestionResolutionStatus.RESOLVED;
    fetcher: OAuthFetcher;
    tokenRefresher: TokenRefresher;
    rateLimiter?: RedisRateLimiter;
  };

interface OAuthIngestionResolutionDependencies {
  createGoogleFetcher: (input: {
    accessToken: string;
    externalCalendarId: string;
    syncToken: string | null;
    rateLimiter?: RedisRateLimiter;
  }) => OAuthFetcher;
  createGoogleRateLimiter: (userId: string) => RedisRateLimiter;
  createGoogleTokenRefresher: (input: {
    clientId: string;
    clientSecret: string;
  }) => TokenRefresher;
  createOutlookFetcher: (input: {
    accessToken: string;
    externalCalendarId: string;
    syncToken: string | null;
  }) => OAuthFetcher;
  createOutlookTokenRefresher: (input: {
    clientId: string;
    clientSecret: string;
  }) => TokenRefresher;
}

const createOAuthIngestionResolutionDependencies = (
  redis: Redis,
): OAuthIngestionResolutionDependencies => ({
  createGoogleFetcher: (input) => createGoogleSourceFetcher(input),
  createGoogleRateLimiter: (userId) =>
    createRedisRateLimiter(
      redis,
      `ratelimit:${userId}:google`,
      { requestsPerMinute: 500 },
    ),
  createGoogleTokenRefresher: (input) => {
    const googleOAuth = createGoogleOAuthService({
      clientId: input.clientId,
      clientSecret: input.clientSecret,
    });
    return (refreshToken) => googleOAuth.refreshAccessToken(refreshToken);
  },
  createOutlookFetcher: (input) => createOutlookSourceFetcher(input),
  createOutlookTokenRefresher: (input) => {
    const microsoftOAuth = createMicrosoftOAuthService({
      clientId: input.clientId,
      clientSecret: input.clientSecret,
    });
    return (refreshToken) => microsoftOAuth.refreshAccessToken(refreshToken);
  },
});

const isOAuthIngestionProvider = (provider: string): provider is OAuthIngestionProviderName =>
  OAUTH_INGESTION_PROVIDER_NAMES.includes(provider as OAuthIngestionProviderName);

const resolveGoogleIngestion = (
  input: OAuthIngestionResolutionInput,
  dependencies: OAuthIngestionResolutionDependencies,
): OAuthIngestionResolution => {
  const { googleClientId, googleClientSecret } = input.oauthConfig;
  if (!googleClientId || !googleClientSecret) {
    return { status: OAuthIngestionResolutionStatus.MISCONFIGURED_PROVIDER };
  }
  if (!input.externalCalendarId) {
    return { status: OAuthIngestionResolutionStatus.MISSING_PROVIDER_CREDENTIALS };
  }

  const rateLimiter = dependencies.createGoogleRateLimiter(input.userId);
  return {
    status: OAuthIngestionResolutionStatus.RESOLVED,
    fetcher: dependencies.createGoogleFetcher({
      accessToken: input.accessToken,
      externalCalendarId: input.externalCalendarId,
      syncToken: input.syncToken,
      rateLimiter,
    }),
    tokenRefresher: dependencies.createGoogleTokenRefresher({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
    }),
    rateLimiter,
  };
};

const resolveOutlookIngestion = (
  input: OAuthIngestionResolutionInput,
  dependencies: OAuthIngestionResolutionDependencies,
): OAuthIngestionResolution => {
  const { microsoftClientId, microsoftClientSecret } = input.oauthConfig;
  if (!microsoftClientId || !microsoftClientSecret) {
    return { status: OAuthIngestionResolutionStatus.MISCONFIGURED_PROVIDER };
  }
  if (!input.externalCalendarId) {
    return { status: OAuthIngestionResolutionStatus.MISSING_PROVIDER_CREDENTIALS };
  }

  return {
    status: OAuthIngestionResolutionStatus.RESOLVED,
    fetcher: dependencies.createOutlookFetcher({
      accessToken: input.accessToken,
      externalCalendarId: input.externalCalendarId,
      syncToken: input.syncToken,
    }),
    tokenRefresher: dependencies.createOutlookTokenRefresher({
      clientId: microsoftClientId,
      clientSecret: microsoftClientSecret,
    }),
  };
};

const resolveOAuthIngestionResolution = (
  input: OAuthIngestionResolutionInput,
  dependencies: OAuthIngestionResolutionDependencies,
): OAuthIngestionResolution => {
  if (!isOAuthIngestionProvider(input.provider)) {
    return { status: OAuthIngestionResolutionStatus.UNSUPPORTED_PROVIDER };
  }

  switch (input.provider) {
    case "google": {
      return resolveGoogleIngestion(input, dependencies);
    }
    case "outlook": {
      return resolveOutlookIngestion(input, dependencies);
    }
    default: {
      return { status: OAuthIngestionResolutionStatus.UNSUPPORTED_PROVIDER };
    }
  }
};

export {
  OAuthIngestionResolutionStatus,
  createOAuthIngestionResolutionDependencies,
  resolveOAuthIngestionResolution,
};
export type {
  OAuthIngestionResolution,
  OAuthIngestionResolutionDependencies,
};
