import env from "@keeper.sh/env/cron";
import { createDatabase } from "@keeper.sh/database";
import { syncStatusTable } from "@keeper.sh/database/schema";
import { createRedis } from "@keeper.sh/redis";
import { createPremiumService } from "@keeper.sh/premium";
import { createBroadcastService } from "@keeper.sh/broadcast";
import { createDestinationProviders, createOAuthProviders } from "@keeper.sh/destination-providers";
import { createSyncCoordinator } from "@keeper.sh/integration";
import type { DestinationSyncResult, SyncProgressUpdate } from "@keeper.sh/integration";
import { Polar } from "@polar-sh/sdk";

const database = createDatabase(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);
const broadcastService = createBroadcastService({ redis });

const premiumService = createPremiumService({
  commercialMode: env.COMMERCIAL_MODE ?? false,
  database,
});

const googleConfig = ((): { clientId: string; clientSecret: string } | null => {
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    return {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    };
  }
  return null;
})();

const microsoftConfig = ((): { clientId: string; clientSecret: string } | null => {
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

const destinationProviders = createDestinationProviders({
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

const createPolarClient = (): Polar | null => {
  if (env.POLAR_ACCESS_TOKEN && env.POLAR_MODE) {
    return new Polar({
      accessToken: env.POLAR_ACCESS_TOKEN,
      server: env.POLAR_MODE,
    });
  }
  return null;
};

const polarClient = createPolarClient();

export { database, premiumService, destinationProviders, syncCoordinator, polarClient };
