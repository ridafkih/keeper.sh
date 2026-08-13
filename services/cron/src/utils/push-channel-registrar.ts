import {
  createCoordinatedRefresher,
  createGoogleTokenRefresher,
  createMicrosoftTokenRefresher,
  createRedisRateLimiter,
  ensureValidToken,
} from "@keeper.sh/calendar";
import type { RegistrarContext, TokenState } from "@keeper.sh/calendar";
import { calendarAccountsTable, oauthCredentialsTable } from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import { database, refreshLockRedis, refreshLockStore, webhookConfig } from "@/context";
import env from "@/env";
import type { RegistrarContextRequest } from "./manage-push-channels-core";

const GOOGLE_REQUESTS_PER_MINUTE = 500;
const SINGLE_REQUEST_SLOT = 1;

const resolveTokenRefresher = (provider: string) => {
  if (provider === "google" && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    return createGoogleTokenRefresher({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    });
  }

  if (provider === "outlook" && env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET) {
    return createMicrosoftTokenRefresher({
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
    });
  }

  return null;
};

const resolveFreshAccessToken = async (
  accountId: string,
  provider: string,
): Promise<string> => {
  const [credentials] = await database
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
    .limit(1);

  if (!credentials) {
    throw new Error(`No OAuth credentials found for push channel account ${accountId}`);
  }

  const tokenState: TokenState = {
    accessToken: credentials.accessToken,
    accessTokenExpiresAt: credentials.expiresAt,
    refreshToken: credentials.refreshToken,
  };

  const rawRefresh = resolveTokenRefresher(provider);
  if (rawRefresh) {
    await ensureValidToken(tokenState, createCoordinatedRefresher({
      calendarAccountId: credentials.calendarAccountId,
      database,
      oauthCredentialId: credentials.oauthCredentialId,
      rawRefresh,
      refreshLockStore,
    }));
  }

  return tokenState.accessToken;
};

const resolveNotificationUrl = (provider: string): string => {
  const config = webhookConfig;
  if (!config) {
    throw new Error("Push channel registration requires WEBHOOK_PUBLIC_URL to be configured");
  }
  if (provider === "google") {
    return config.googleCallbackUrl;
  }
  if (provider === "outlook") {
    return config.outlookCallbackUrl;
  }
  throw new Error(`No push notification url is defined for provider ${provider}`);
};

const createRegistrarContext = async (
  request: RegistrarContextRequest,
): Promise<RegistrarContext> => ({
  accessToken: await resolveFreshAccessToken(request.scope.accountId, request.provider),
  channelId: request.channelId,
  fetchImpl: globalThis.fetch,
  notificationUrl: resolveNotificationUrl(request.provider),
  now: new Date(),
  ...(request.provider === "google" && {
    rateLimiter: {
      acquire: () => createRedisRateLimiter(
        refreshLockRedis,
        `ratelimit:${request.scope.userId}:google`,
        { requestsPerMinute: GOOGLE_REQUESTS_PER_MINUTE },
      ).acquire(SINGLE_REQUEST_SLOT),
    },
  }),
  requestedExpiresAt: request.requestedExpiresAt,
});

export { createRegistrarContext, resolveFreshAccessToken, resolveNotificationUrl };
