import { measureRedisCommand } from "../telemetry/segments";

const RETRY_BASE_MS = 200;
const RETRY_JITTER_MS = 150;

interface SemaphoreLease {
  slotKey: string;
  token: string;
}

interface LeasedSemaphore {
  acquireLease(key: string, signal?: AbortSignal): Promise<SemaphoreLease>;
  release(lease: SemaphoreLease): Promise<void>;
}

interface LeasedSemaphoreConfig {
  capacity: number;
  ttlMs: number;
}

interface RedisLeaseClient {
  del(...keys: string[]): Promise<number>;
  set(key: string, value: string, ...options: string[]): Promise<string | null>;
}

const sleepWithSignal = (delayMs: number, signal?: AbortSignal): Promise<void> => {
  if (signal?.aborted) {
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onAbort = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      reject(signal?.reason);
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
};

/*
 * Each slot is its own Redis key claimed with SET NX PX, so a crashed holder's
 * lease expires on its own instead of wedging the account the way a bare
 * INCR/DECR counter would.
 */
const createLeasedSemaphore = (
  redis: RedisLeaseClient,
  config: LeasedSemaphoreConfig,
): LeasedSemaphore => {
  const { capacity, ttlMs } = config;

  const tryAcquire = async (key: string): Promise<SemaphoreLease | null> => {
    const token = crypto.randomUUID();
    for (let slot = 0; slot < capacity; slot += 1) {
      const slotKey = `semaphore:${key}:slot:${slot}`;
      const granted = await measureRedisCommand(() =>
        redis.set(slotKey, token, "NX", "PX", String(ttlMs)));
      if (granted !== null) {
        return { slotKey, token };
      }
    }
    return null;
  };

  const acquireLease = async (key: string, signal?: AbortSignal): Promise<SemaphoreLease> => {
    while (true) {
      signal?.throwIfAborted();
      const lease = await tryAcquire(key);
      if (lease !== null) {
        return lease;
      }
      // Jitter keeps parked acquirers from stampeding Redis in lockstep.
      const delayMs = RETRY_BASE_MS + Math.floor(Math.random() * RETRY_JITTER_MS);
      await sleepWithSignal(delayMs, signal);
    }
  };

  const release = async (lease: SemaphoreLease): Promise<void> => {
    await measureRedisCommand(() => redis.del(lease.slotKey));
  };

  return { acquireLease, release };
};

export { createLeasedSemaphore };
export type {
  LeasedSemaphore,
  LeasedSemaphoreConfig,
  RedisLeaseClient,
  SemaphoreLease,
};
