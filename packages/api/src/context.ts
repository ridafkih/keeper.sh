import env from "@keeper.sh/env/api";
import { createDatabase } from "@keeper.sh/database";
import { syncStatusTable } from "@keeper.sh/database/schema";
import { createRedis } from "@keeper.sh/redis";
import { createAuth } from "@keeper.sh/auth";
import { createBroadcastService } from "@keeper.sh/broadcast";
import { createPremiumService } from "@keeper.sh/premium";
import {
  createOAuthProviders,
  createDestinationProviders,
} from "@keeper.sh/destination-providers";
import {
  createSyncCoordinator,
  type DestinationSyncResult,
  type SyncProgressUpdate,
} from "@keeper.sh/integrations";
import { eq } from "drizzle-orm";

export const database = createDatabase(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);

export const { auth } = createAuth({
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
});

export const broadcastService = createBroadcastService({ redis });

export const premiumService = createPremiumService({
  database,
  commercialMode: env.COMMERCIAL_MODE ?? false,
});

export const oauthProviders = createOAuthProviders({
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

const broadcastSyncStatus = (
  userId: string,
  destinationId: string,
  data: { needsReauthentication: boolean },
) => {
  broadcastService.emit(userId, "sync:status", {
    destinationId,
    status: "idle",
    localEventCount: 0,
    remoteEventCount: 0,
    inSync: false,
    needsReauthentication: data.needsReauthentication,
  });
};

export const destinationProviders = createDestinationProviders({
  database,
  oauthProviders,
  encryptionKey: env.ENCRYPTION_KEY ?? "",
  broadcastSyncStatus,
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

export const baseUrl = env.BETTER_AUTH_URL;
export const encryptionKey = env.ENCRYPTION_KEY;
