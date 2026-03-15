import env from "./env";
import { createDatabase } from "@keeper.sh/database";
import { syncStatusTable } from "@keeper.sh/database/schema";
import Redis from "ioredis";
import { createPremiumService } from "@keeper.sh/premium";
import { createBroadcastService } from "@keeper.sh/broadcast";
import {
  createSyncCoordinator,
  createOAuthProviders,
  buildOAuthConfigs,
  createSyncAggregateRuntime,
} from "@keeper.sh/calendar";
import type { DestinationProvider, RefreshLockStore } from "@keeper.sh/calendar";
import { createDestinationProviders } from "@keeper.sh/calendar";
import type { DestinationSyncResult, SyncCoordinator } from "@keeper.sh/calendar";
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

const createRedisRefreshLockStore = (redisClient: Redis): RefreshLockStore => ({
  async tryAcquire(key, ttlSeconds) {
    const result = await redisClient.set(key, "1", "EX", ttlSeconds, "NX");
    return result !== null;
  },
  async release(key) {
    await redisClient.del(key);
  },
});
const REDIS_COMMAND_TIMEOUT_MS = 10_000;

const createRedisClient = (url: string): Redis =>
  new Redis(url, {
    commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
    maxRetriesPerRequest: 3,
  });

const refreshLockRedis = createRedisClient(env.REDIS_URL);
const refreshLockStore = createRedisRefreshLockStore(refreshLockRedis);

const createSyncContext = (): SyncContext => {
  const redis = createRedisClient(env.REDIS_URL);

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
    redis.disconnect();
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
