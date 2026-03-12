import { Resend } from "resend";
import env from "@keeper.sh/env/api";
import { createDatabase } from "@keeper.sh/database";
import { syncStatusTable } from "@keeper.sh/database/schema";
import { RedisClient } from "bun";
import { createAuth } from "@keeper.sh/auth";
import { createBroadcastService } from "@keeper.sh/broadcast";
import { createPremiumService } from "@keeper.sh/premium";
import {
  createSyncCoordinator,
  createOAuthProviders,
  buildOAuthConfigs,
  createSyncAggregateRuntime,
} from "@keeper.sh/provider-core";
import { createDestinationProviders } from "@keeper.sh/provider-registry/server";
import type { DestinationSyncResult } from "@keeper.sh/provider-core";

const INITIAL_EVENT_COUNT = 0;
const MIN_TRUSTED_ORIGINS_COUNT = 0;

const database = createDatabase(env.DATABASE_URL);
const redis = new RedisClient(env.REDIS_URL);

const parseTrustedOrigins = (origins?: string): string[] => {
  if (!origins) {
    return [];
  }
  return origins.split(",").map((origin): string => origin.trim());
};

const trustedOrigins = parseTrustedOrigins(env.TRUSTED_ORIGINS);

const { auth, capabilities: authCapabilities } = createAuth({
  database,
  secret: env.BETTER_AUTH_SECRET,
  baseUrl: env.BETTER_AUTH_URL,
  webBaseUrl: env.WEB_BASE_URL,
  commercialMode: env.COMMERCIAL_MODE ?? false,
  polarAccessToken: env.POLAR_ACCESS_TOKEN,
  polarMode: env.POLAR_MODE,
  googleClientId: env.GOOGLE_CLIENT_ID,
  googleClientSecret: env.GOOGLE_CLIENT_SECRET,
  microsoftClientId: env.MICROSOFT_CLIENT_ID,
  microsoftClientSecret: env.MICROSOFT_CLIENT_SECRET,
  resendApiKey: env.RESEND_API_KEY,
  passkeyRpId: env.PASSKEY_RP_ID,
  passkeyRpName: env.PASSKEY_RP_NAME,
  passkeyOrigin: env.PASSKEY_ORIGIN,
  mcpResourceUrl: env.MCP_RESOURCE_URL,
  ...(trustedOrigins.length > MIN_TRUSTED_ORIGINS_COUNT && { trustedOrigins }),
});

const broadcastService = createBroadcastService({ redis });

const premiumService = createPremiumService({
  commercialMode: env.COMMERCIAL_MODE ?? false,
  database,
});

const oauthConfigs = buildOAuthConfigs(env);
const oauthProviders = createOAuthProviders(oauthConfigs);

const broadcastSyncStatus = (
  userId: string,
  calendarId: string,
  data: { needsReauthentication: boolean },
): void => {
  broadcastService.emit(userId, "sync:status", {
    calendarId,
    inSync: false,
    localEventCount: INITIAL_EVENT_COUNT,
    needsReauthentication: data.needsReauthentication,
    remoteEventCount: INITIAL_EVENT_COUNT,
    status: "idle",
  });
};

const destinationProviders = createDestinationProviders({
  broadcastSyncStatus,
  database,
  encryptionKey: env.ENCRYPTION_KEY,
  oauthProviders,
});

const persistSyncStatus = async (
  result: DestinationSyncResult,
  syncedAt: Date,
): Promise<void> => {
  await database
    .insert(syncStatusTable)
    .values({
      calendarId: result.calendarId,
      lastSyncedAt: syncedAt,
      localEventCount: result.localEventCount,
      remoteEventCount: result.remoteEventCount,
    })
    .onConflictDoUpdate({
      set: {
        lastSyncedAt: syncedAt,
        localEventCount: result.localEventCount,
        remoteEventCount: result.remoteEventCount,
      },
      target: [syncStatusTable.calendarId],
    });
};

const syncAggregateRuntime = createSyncAggregateRuntime({
  broadcast: (userId, eventName, payload): void => {
    broadcastService.emit(userId, eventName, payload);
  },
  persistSyncStatus,
  redis,
});

const getCurrentSyncAggregate = (
  userId: string,
  fallback: {
    progressPercent: number;
    syncEventsProcessed: number;
    syncEventsRemaining: number;
    syncEventsTotal: number;
    lastSyncedAt: string | null;
  },
) => syncAggregateRuntime.getCurrentSyncAggregate(userId, fallback);

const getCachedSyncAggregate = (userId: string) =>
  syncAggregateRuntime.getCachedSyncAggregate(userId);

const syncCoordinator = createSyncCoordinator({
  onDestinationSync: syncAggregateRuntime.onDestinationSync,
  onSyncProgress: syncAggregateRuntime.onSyncProgress,
  redis,
});

const createResendClient = (): Resend | null => {
  if (!env.RESEND_API_KEY) {
    return null;
  }

  return new Resend(env.RESEND_API_KEY);
};

const resend = createResendClient();
const feedbackEmail = env.FEEDBACK_EMAIL ?? null;

const baseUrl = env.BETTER_AUTH_URL;
const encryptionKey = env.ENCRYPTION_KEY;

export {
  database,
  redis,
  env,
  trustedOrigins,
  auth,
  authCapabilities,
  broadcastService,
  premiumService,
  oauthProviders,
  destinationProviders,
  syncCoordinator,
  resend,
  feedbackEmail,
  baseUrl,
  encryptionKey,
  getCurrentSyncAggregate,
  getCachedSyncAggregate,
};
