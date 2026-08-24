import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { calendarAccountsTable, oauthCredentialsTable } from "@keeper.sh/database/schema";
import { createCoordinatedRefresher } from "../oauth/coordinated-refresher";
import { createGoogleTokenRefresher } from "../oauth/google";
import { createMicrosoftTokenRefresher } from "../oauth/microsoft";
import { createRedisRateLimiter } from "../utils/redis-rate-limiter";
import { ensureValidToken } from "../oauth/ensure-valid-token";
import type { TokenState } from "../oauth/ensure-valid-token";
import type { RegistrarContext } from "./push-channel";
import type { RegistrarContextRequest } from "./manage-push-channels";

const GOOGLE_REQUESTS_PER_MINUTE = 500;
const SINGLE_REQUEST_SLOT = 1;
const FIRST_ROW_LIMIT = 1;

interface WebhookCallbackUrls {
  googleCallbackUrl: string;
  outlookCallbackUrl: string;
}

interface RefreshLockStore {
  release: (key: string) => Promise<void>;
  tryAcquire: (key: string, ttlSeconds: number) => Promise<boolean>;
}

interface RegistrarContextConfig {
  database: BunSQLDatabase;
  googleClientId?: string;
  googleClientSecret?: string;
  microsoftClientId?: string;
  microsoftClientSecret?: string;
  rateLimiterRedis: Parameters<typeof createRedisRateLimiter>[0];
  refreshLockStore: RefreshLockStore;
  webhookConfig: WebhookCallbackUrls | null;
}

const resolveTokenRefresher = (provider: string, config: RegistrarContextConfig) => {
  if (provider === "google" && config.googleClientId && config.googleClientSecret) {
    return createGoogleTokenRefresher({
      clientId: config.googleClientId,
      clientSecret: config.googleClientSecret,
    });
  }

  if (provider === "outlook" && config.microsoftClientId && config.microsoftClientSecret) {
    return createMicrosoftTokenRefresher({
      clientId: config.microsoftClientId,
      clientSecret: config.microsoftClientSecret,
    });
  }

  return null;
};

const resolveNotificationUrl = (
  provider: string,
  webhookConfig: WebhookCallbackUrls | null,
): string => {
  if (!webhookConfig) {
    throw new Error("Push channel registration requires WEBHOOK_PUBLIC_URL to be configured");
  }
  if (provider === "google") {
    return webhookConfig.googleCallbackUrl;
  }
  if (provider === "outlook") {
    return webhookConfig.outlookCallbackUrl;
  }
  throw new Error(`No push notification url is defined for provider ${provider}`);
};

const resolveFreshAccessToken = async (
  accountId: string,
  provider: string,
  config: RegistrarContextConfig,
): Promise<string> => {
  const [credentials] = await config.database
    .select({
      accessToken: oauthCredentialsTable.accessToken,
      calendarAccountId: calendarAccountsTable.id,
      expiresAt: oauthCredentialsTable.expiresAt,
      oauthCredentialId: oauthCredentialsTable.id,
      refreshToken: oauthCredentialsTable.refreshToken,
    })
    .from(calendarAccountsTable)
    .innerJoin(
      oauthCredentialsTable,
      eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id),
    )
    .where(eq(calendarAccountsTable.id, accountId))
    .limit(FIRST_ROW_LIMIT);

  if (!credentials) {
    throw new Error(`No OAuth credentials found for push channel account ${accountId}`);
  }

  const tokenState: TokenState = {
    accessToken: credentials.accessToken,
    accessTokenExpiresAt: credentials.expiresAt,
    refreshToken: credentials.refreshToken,
  };

  const rawRefresh = resolveTokenRefresher(provider, config);
  if (rawRefresh) {
    await ensureValidToken(tokenState, createCoordinatedRefresher({
      calendarAccountId: credentials.calendarAccountId,
      database: config.database,
      oauthCredentialId: credentials.oauthCredentialId,
      rawRefresh,
      refreshLockStore: config.refreshLockStore,
    }));
  }

  return tokenState.accessToken;
};

/*
 * Registration happens from the cron sweep and from the API the moment an account is
 * connected. Both need a fresh access token, the provider's callback url and Google's
 * rate limiter; only the context each service holds differs.
 */
const createRegistrarContextFactory = (config: RegistrarContextConfig) =>
  async (request: RegistrarContextRequest): Promise<RegistrarContext> => ({
    accessToken: await resolveFreshAccessToken(request.scope.accountId, request.provider, config),
    channelId: request.channelId,
    fetchImpl: globalThis.fetch,
    notificationUrl: resolveNotificationUrl(request.provider, config.webhookConfig),
    now: new Date(),
    ...(request.provider === "google" && {
      rateLimiter: {
        acquire: () => createRedisRateLimiter(
          config.rateLimiterRedis,
          `ratelimit:${request.scope.userId}:google`,
          { requestsPerMinute: GOOGLE_REQUESTS_PER_MINUTE },
        ).acquire(SINGLE_REQUEST_SLOT),
      },
    }),
    requestedExpiresAt: request.requestedExpiresAt,
  });

export { createRegistrarContextFactory, resolveNotificationUrl };
export type { RegistrarContextConfig, WebhookCallbackUrls };
