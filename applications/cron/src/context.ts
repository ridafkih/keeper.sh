import env from "@keeper.sh/env/cron";
import { createDatabase } from "@keeper.sh/database";
import { syncStatusTable } from "@keeper.sh/database/schema";
import { RedisClient } from "bun";
import { createPremiumService } from "@keeper.sh/premium";
import { createBroadcastService } from "@keeper.sh/broadcast";
import {
  createSyncCoordinator,
  createOAuthProviders,
  buildOAuthConfigs,
  createSyncAggregateRuntime,
} from "@keeper.sh/provider-core";
import type { DestinationProvider, RefreshLockStore } from "@keeper.sh/provider-core";
import { createDestinationProviders } from "@keeper.sh/provider-registry/server";
import type { DestinationSyncResult, SyncCoordinator } from "@keeper.sh/provider-core";
import { Polar } from "@polar-sh/sdk";

const database = createDatabase(env.DATABASE_URL);

const premiumService = createPremiumService({
  commercialMode: env.COMMERCIAL_MODE ?? false,
  database,
});

const oauthConfigs = buildOAuthConfigs(env);
const oauthProviders = createOAuthProviders(oauthConfigs);

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

interface SyncContext {
  destinationProviders: DestinationProvider[];
  syncCoordinator: SyncCoordinator;
  close: () => void;
}

const createRedisRefreshLockStore = (redisClient: RedisClient): RefreshLockStore => ({
  async tryAcquire(key, ttlSeconds) {
    const result = await redisClient.send("SET", [key, "1", "EX", String(ttlSeconds), "NX"]);
    return result !== null;
  },
  async release(key) {
    await redisClient.del(key);
  },
});
const refreshLockRedis = new RedisClient(env.REDIS_URL);
const refreshLockStore = createRedisRefreshLockStore(refreshLockRedis);

const createSyncContext = (): SyncContext => {
  const redis = new RedisClient(env.REDIS_URL);

  const destinationProviders = createDestinationProviders({
    database,
    encryptionKey: env.ENCRYPTION_KEY,
    oauthProviders,
    refreshLockStore,
  });

  const broadcastService = createBroadcastService({ redis });

  const syncAggregateRuntime = createSyncAggregateRuntime({
    broadcast: (userId, eventName, payload): void => {
      broadcastService.emit(userId, eventName, payload);
    },
    persistSyncStatus,
    redis,
  });

  const syncCoordinator = createSyncCoordinator({
    onDestinationSync: syncAggregateRuntime.onDestinationSync,
    onSyncProgress: syncAggregateRuntime.onSyncProgress,
    redis,
  });

  const close = (): void => {
    redis.close();
  };

  return { destinationProviders, syncCoordinator, close };
};

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

export { database, premiumService, createSyncContext, polarClient, refreshLockStore };
