import env from "./env";
import { createDatabase } from "@keeper.sh/database";
import Redis from "ioredis";
import type { RefreshLockStore } from "@keeper.sh/calendar";

const database = await createDatabase(env.DATABASE_URL);

const REDIS_COMMAND_TIMEOUT_MS = 10_000;
const REDIS_MAX_RETRIES = 3;

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
  maxRetriesPerRequest: REDIS_MAX_RETRIES,
  lazyConnect: true,
});

const refreshLockStore = createRedisRefreshLockStore(refreshLockRedis);

const shutdownConnections = (): void => {
  refreshLockRedis.disconnect();
};

export { database, refreshLockRedis, refreshLockStore, shutdownConnections };
