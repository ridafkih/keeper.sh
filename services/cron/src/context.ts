import { FLUSH_WRITER_CONNECTIONS } from "@/utils/flush-writer";
import env from "./env";
import { createFlushDrainRegistry } from "./utils/flush-drains";
import { createInFlightDrainRegistry } from "./utils/in-flight-drains";
import { closeDatabase, createDatabase } from "@keeper.sh/database";
import Redis from "ioredis";
import { createPremiumService } from "@keeper.sh/premium";
import { resolveWebhookConfig } from "@keeper.sh/calendar";
import type { RefreshLockStore } from "@keeper.sh/calendar";
import { Polar } from "@polar-sh/sdk";

const database = await createDatabase(env.DATABASE_URL, { maxConnections: env.DATABASE_POOL_MAX });

/*
 * The flush writer gets its own single connection so ingest persistence
 * cannot open concurrent write transactions no matter how many fetches run.
 */
const flushDatabase = await createDatabase(env.DATABASE_URL, {
  maxConnections: FLUSH_WRITER_CONNECTIONS,
});

const flushDrainRegistry = createFlushDrainRegistry();

const inFlightDrainRegistry = createInFlightDrainRegistry();

const FLUSH_DRAIN_DEADLINE_MS = 2000;
/*
 * Bun's unbounded close awaits the very in-flight query the drain deadline just gave up on,
 * so leaving teardown unbounded would hand the wedged flush back the time the deadline removed.
 */
const CLOSE_GRACE_SECONDS = 2;

const shutdownDatabases = async (): Promise<void> => {
  const drain = flushDrainRegistry.drain().then(
    () => "drained",
    () => "drain-failed",
  );
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<void>((resolve) => {
    deadlineTimer = setTimeout(resolve, FLUSH_DRAIN_DEADLINE_MS);
  });
  try {
    await Promise.race([drain, deadline]);
  } finally {
    if (deadlineTimer !== null) {
      clearTimeout(deadlineTimer);
    }
  }
  closeDatabase(database, { graceSeconds: CLOSE_GRACE_SECONDS });
  closeDatabase(flushDatabase, { graceSeconds: CLOSE_GRACE_SECONDS });
};
const webhookConfig = resolveWebhookConfig(env.WEBHOOK_PUBLIC_URL);

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

/*
 * Its own connection with no command timeout: a blocking read occupies the connection for
 * as long as it waits, so sharing one would stall every other command behind it, and a
 * command timeout would abort the wait it exists to perform.
 */
const signalReaderRedis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

const shutdownSignalReaderRedis = (): void => {
  signalReaderRedis.disconnect();
};

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

export {
  database,
  flushDatabase,
  flushDrainRegistry,
  inFlightDrainRegistry,
  shutdownDatabases,
  premiumService,
  polarClient,
  refreshLockRedis,
  refreshLockStore,
  shutdownRefreshLockRedis,
  shutdownSignalReaderRedis,
  signalReaderRedis,
  webhookConfig,
};
