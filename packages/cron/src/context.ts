import env from "@keeper.sh/env/cron";
import { createDatabase } from "@keeper.sh/database";
import { syncStatusTable } from "@keeper.sh/database/schema";
import { createRedis } from "@keeper.sh/redis";
import { createPremiumService } from "@keeper.sh/premium";
import { createBroadcastService } from "@keeper.sh/broadcast";
import { createOAuthProviders, createDestinationProviders } from "@keeper.sh/destination-providers";
import {
  createSyncCoordinator,
  type DestinationSyncResult,
  type SyncProgressUpdate,
} from "@keeper.sh/integration";
import { Polar } from "@polar-sh/sdk";
import { eq } from "drizzle-orm";

export const database = createDatabase(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);
const broadcastService = createBroadcastService({ redis });

export const premiumService = createPremiumService({
  database,
  commercialMode: env.COMMERCIAL_MODE ?? false,
});

const oauthProviders = createOAuthProviders({
  google:
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
        }
      : undefined,
  microsoft:
    env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET
      ? {
          clientId: env.MICROSOFT_CLIENT_ID,
          clientSecret: env.MICROSOFT_CLIENT_SECRET,
        }
      : undefined,
});

export const destinationProviders = createDestinationProviders({
  database,
  oauthProviders,
  encryptionKey: env.ENCRYPTION_KEY ?? "",
});

const onDestinationSync = async (result: DestinationSyncResult) => {
  const now = new Date();

  await database
    .insert(syncStatusTable)
    .values({
      destinationId: result.destinationId,
      localEventCount: result.localEventCount,
      remoteEventCount: result.remoteEventCount,
      lastSyncedAt: now,
    })
    .onConflictDoUpdate({
      target: [syncStatusTable.destinationId],
      set: {
        localEventCount: result.localEventCount,
        remoteEventCount: result.remoteEventCount,
        lastSyncedAt: now,
      },
    });

  if (result.broadcast !== false) {
    broadcastService.emit(result.userId, "sync:status", {
      destinationId: result.destinationId,
      status: "idle",
      localEventCount: result.localEventCount,
      remoteEventCount: result.remoteEventCount,
      inSync: result.localEventCount === result.remoteEventCount,
      lastSyncedAt: now.toISOString(),
    });
  }
};

const onSyncProgress = (update: SyncProgressUpdate) => {
  broadcastService.emit(update.userId, "sync:status", {
    destinationId: update.destinationId,
    status: update.status,
    stage: update.stage,
    localEventCount: update.localEventCount,
    remoteEventCount: update.remoteEventCount,
    progress: update.progress,
    lastOperation: update.lastOperation,
    inSync: update.inSync,
  });
};

export const syncCoordinator = createSyncCoordinator({
  redis,
  onDestinationSync,
  onSyncProgress,
});

export const polarClient =
  env.POLAR_ACCESS_TOKEN && env.POLAR_MODE
    ? new Polar({
        accessToken: env.POLAR_ACCESS_TOKEN,
        server: env.POLAR_MODE,
      })
    : null;
