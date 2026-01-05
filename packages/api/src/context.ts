import env from "@keeper.sh/env/api";
import { createDatabase } from "@keeper.sh/database";
import { syncStatusTable } from "@keeper.sh/database/schema";
import { createRedis } from "@keeper.sh/redis";
import { createAuth } from "@keeper.sh/auth";
import { createBroadcastService } from "@keeper.sh/broadcast";
import { createPremiumService } from "@keeper.sh/premium";
import { createDestinationProviders, createOAuthProviders } from "@keeper.sh/destination-providers";
import { createSyncCoordinator } from "@keeper.sh/integration";
import type { DestinationSyncResult, SyncProgressUpdate } from "@keeper.sh/integration";

const INITIAL_EVENT_COUNT = 0;
const MIN_TRUSTED_ORIGINS_COUNT = 0;

const database = createDatabase(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);

const parseTrustedOrigins = (origins?: string): string[] => {
  if (!origins) {
    return [];
  }
  return origins.split(",").map((origin): string => origin.trim());
};

const trustedOrigins = parseTrustedOrigins(env.TRUSTED_ORIGINS);

const { auth } = createAuth({
  database,
  secret: env.BETTER_AUTH_SECRET,
  baseUrl: env.BETTER_AUTH_URL,
  commercialMode: env.COMMERCIAL_MODE ?? false,
  polarAccessToken: env.POLAR_ACCESS_TOKEN,
  polarMode: env.POLAR_MODE,
  googleClientId: env.GOOGLE_CLIENT_ID,
  googleClientSecret: env.GOOGLE_CLIENT_SECRET,
  resendApiKey: env.RESEND_API_KEY,
  passkeyRpId: env.PASSKEY_RP_ID,
  passkeyRpName: env.PASSKEY_RP_NAME,
  passkeyOrigin: env.PASSKEY_ORIGIN,
  ...(trustedOrigins.length > MIN_TRUSTED_ORIGINS_COUNT && { trustedOrigins }),
});

const broadcastService = createBroadcastService({ redis });

const premiumService = createPremiumService({
  commercialMode: env.COMMERCIAL_MODE ?? false,
  database,
});

interface OAuthConfig {
  clientId: string;
  clientSecret: string;
}

const googleConfig = ((): OAuthConfig | null => {
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    return {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    };
  }
  return null;
})();

const microsoftConfig = ((): OAuthConfig | null => {
  if (env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET) {
    return {
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
    };
  }
  return null;
})();

const oauthProviders = createOAuthProviders({
  google: googleConfig,
  microsoft: microsoftConfig,
});

const broadcastSyncStatus = (
  userId: string,
  destinationId: string,
  data: { needsReauthentication: boolean },
): void => {
  broadcastService.emit(userId, "sync:status", {
    destinationId,
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
  encryptionKey: env.ENCRYPTION_KEY ?? "",
  oauthProviders,
});

const onDestinationSync = async (result: DestinationSyncResult): Promise<void> => {
  const now = new Date();

  await database
    .insert(syncStatusTable)
    .values({
      destinationId: result.destinationId,
      lastSyncedAt: now,
      localEventCount: result.localEventCount,
      remoteEventCount: result.remoteEventCount,
    })
    .onConflictDoUpdate({
      set: {
        lastSyncedAt: now,
        localEventCount: result.localEventCount,
        remoteEventCount: result.remoteEventCount,
      },
      target: [syncStatusTable.destinationId],
    });

  if (result.broadcast !== false) {
    broadcastService.emit(result.userId, "sync:status", {
      destinationId: result.destinationId,
      inSync: result.localEventCount === result.remoteEventCount,
      lastSyncedAt: now.toISOString(),
      localEventCount: result.localEventCount,
      remoteEventCount: result.remoteEventCount,
      status: "idle",
    });
  }
};

const onSyncProgress = (update: SyncProgressUpdate): void => {
  broadcastService.emit(update.userId, "sync:status", {
    destinationId: update.destinationId,
    inSync: update.inSync,
    lastOperation: update.lastOperation,
    localEventCount: update.localEventCount,
    progress: update.progress,
    remoteEventCount: update.remoteEventCount,
    stage: update.stage,
    status: update.status,
  });
};

const syncCoordinator = createSyncCoordinator({
  onDestinationSync,
  onSyncProgress,
  redis,
});

const baseUrl = env.BETTER_AUTH_URL;
const encryptionKey = env.ENCRYPTION_KEY;

export {
  database,
  trustedOrigins,
  auth,
  broadcastService,
  premiumService,
  oauthProviders,
  destinationProviders,
  syncCoordinator,
  baseUrl,
  encryptionKey,
};
