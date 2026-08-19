import { measureRedisCommand } from "../telemetry/segments";

const RETRY_BASE_MS = 200;
const RETRY_JITTER_MS = 150;
// Margin guarding against DEL landing on a slot reclaimed right at the TTL edge.
const RELEASE_SAFETY_MS = 1000;

interface SemaphoreLease {
  safeToDeleteUntil: number;
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
      /*
       * Timestamped BEFORE the SET is sent: the server applies the PX expiry
       * at some point at or after this instant, so the key cannot lapse before
       * requestedAt + ttlMs. Inside that window (minus a safety margin) the
       * slot provably still holds this token, making a bare DEL exact.
       */
      const requestedAt = Date.now();
      const granted = await measureRedisCommand(() =>
        redis.set(slotKey, token, "NX", "PX", String(ttlMs)));
      if (granted !== null) {
        return { safeToDeleteUntil: requestedAt + ttlMs - RELEASE_SAFETY_MS, slotKey, token };
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

  /*
   * The lease client exposes only SET/DEL (no GET, no EVAL), so ownership is
   * fenced by time instead of a compare-and-delete script: once the lease's
   * safe-delete window has passed, the slot may already have expired and been
   * reclaimed by another holder, and deleting it would break the capacity
   * bound. Past the window the DEL is skipped and the TTL reaps the key.
   */
  const release = async (lease: SemaphoreLease): Promise<void> => {
    if (Date.now() >= lease.safeToDeleteUntil) {
      return;
    }
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
