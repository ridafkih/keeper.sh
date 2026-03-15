import env from "./env";
import { createDatabase } from "@keeper.sh/database";
import Redis from "ioredis";
import { createPremiumService } from "@keeper.sh/premium";
import type { RefreshLockStore } from "@keeper.sh/calendar";
import { Polar } from "@polar-sh/sdk";

const database = await createDatabase(env.DATABASE_URL);

const premiumService = createPremiumService({
  commercialMode: env.COMMERCIAL_MODE ?? false,
  database,
});

const REDIS_COMMAND_TIMEOUT_MS = 10_000;

const createRedisRefreshLockStore = (redisClient: Redis): RefreshLockStore => ({
  async tryAcquire(key, ttlSeconds) {
    const result = await redisClient.set(key, "1", "EX", ttlSeconds, "NX");
    return result !== null;
  },
  async release(key) {
    await redisClient.del(key);
  },
});

const refreshLockRedis = new Redis(env.REDIS_URL, {
  commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

const refreshLockStore = createRedisRefreshLockStore(refreshLockRedis);

const shutdownRefreshLockRedis = (): void => {
  refreshLockRedis.disconnect();
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

export { database, premiumService, polarClient, refreshLockStore, shutdownRefreshLockRedis };
