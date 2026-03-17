const LOCK_PREFIX = "sync:lock:";
const SIGNAL_PREFIX = "sync:signal:";
const INVALIDATION_PREFIX = "sync:invalidated:";
const LOCK_TTL_SECONDS = 120;
const INVALIDATION_TTL_SECONDS = 300;
const POLL_INTERVAL_MS = 250;
const POLL_TIMEOUT_MS = (LOCK_TTL_SECONDS * 1000) + 10_000;

interface SyncLockRedis {
  get: (key: string) => Promise<string | null>;
  eval: (script: string, keyCount: number, ...args: string[]) => Promise<unknown>;
}

interface InvalidationRedis {
  set: (...args: [string, string, string, number]) => Promise<unknown>;
}

interface SyncLockHandle {
  isCurrent: () => Promise<boolean>;
  release: () => Promise<void>;
}

interface AcquireSyncLockResult {
  acquired: true;
  handle: SyncLockHandle;
}

interface SyncLockSkippedResult {
  acquired: false;
}

/**
 * Lua script to atomically acquire or signal the sync lock.
 *
 * KEYS[1] = lock key
 * KEYS[2] = signal key
 * ARGV[1] = holder ID
 * ARGV[2] = lock TTL in seconds
 *
 * Returns:
 *   "acquired"  — lock was free, caller now holds it
 *   "queued"    — lock was held, caller is now the pending waiter
 *   "replaced"  — lock was held and there was already a waiter; old waiter replaced
 */
const ACQUIRE_OR_SIGNAL_SCRIPT = `
  local lock = redis.call('GET', KEYS[1])
  if not lock then
    redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
    redis.call('DEL', KEYS[2])
    return 'acquired'
  end

  local existing = redis.call('GET', KEYS[2])
  redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2])

  if existing then
    return 'replaced'
  end
  return 'queued'
`;

/**
 * Lua script to release the lock only if we still hold it.
 *
 * KEYS[1] = lock key
 * ARGV[1] = holder ID
 */
const RELEASE_SCRIPT = `
  local holder = redis.call('GET', KEYS[1])
  if holder == ARGV[1] then
    redis.call('DEL', KEYS[1])
    return 1
  end
  return 0
`;

const createLockHandle = (
  redis: SyncLockRedis,
  lockKey: string,
  signalKey: string,
  invalidationKey: string,
  holderId: string,
): SyncLockHandle => {
  const isCurrent = async (): Promise<boolean> => {
    const [pendingWaiter, invalidated] = await Promise.all([
      redis.get(signalKey),
      redis.get(invalidationKey),
    ]);

    if (invalidated !== null) {
      return false;
    }

    return pendingWaiter === null;
  };

  const release = async (): Promise<void> => {
    await redis.eval(RELEASE_SCRIPT, 1, lockKey, holderId);
  };

  return { isCurrent, release };
};

const createSyncLock = (redis: SyncLockRedis) => {
  const acquire = async (
    calendarId: string,
    abortSignal?: AbortSignal,
  ): Promise<AcquireSyncLockResult | SyncLockSkippedResult> => {
    const lockKey = `${LOCK_PREFIX}${calendarId}`;
    const signalKey = `${SIGNAL_PREFIX}${calendarId}`;
    const invalidationKey = `${INVALIDATION_PREFIX}${calendarId}`;
    const holderId = crypto.randomUUID();

    const result = await redis.eval(
      ACQUIRE_OR_SIGNAL_SCRIPT,
      2,
      lockKey,
      signalKey,
      holderId,
      String(LOCK_TTL_SECONDS),
    );

    if (result === "acquired") {
      const handle = createLockHandle(redis, lockKey, signalKey, invalidationKey, holderId);
      return { acquired: true, handle };
    }

    const pollDeadline = Date.now() + POLL_TIMEOUT_MS;

    while (Date.now() < pollDeadline) {
      if (abortSignal?.aborted) {
        return { acquired: false };
      }

      const currentWaiter = await redis.get(signalKey);
      if (currentWaiter !== holderId) {
        return { acquired: false };
      }

      const lockHolder = await redis.get(lockKey);
      if (!lockHolder) {
        const retryResult = await redis.eval(
          ACQUIRE_OR_SIGNAL_SCRIPT,
          2,
          lockKey,
          signalKey,
          holderId,
          String(LOCK_TTL_SECONDS),
        );

        if (retryResult === "acquired") {
          const handle = createLockHandle(redis, lockKey, signalKey, invalidationKey, holderId);
          return { acquired: true, handle };
        }
      }

      await Bun.sleep(POLL_INTERVAL_MS);
    }

    return { acquired: false };
  };

  return { acquire };
};

const invalidateCalendar = async (redis: InvalidationRedis, calendarId: string): Promise<void> => {
  const key = `${INVALIDATION_PREFIX}${calendarId}`;
  await redis.set(key, "1", "EX", INVALIDATION_TTL_SECONDS);
};

const isCalendarInvalidated = async (redis: SyncLockRedis, calendarId: string): Promise<boolean> => {
  const key = `${INVALIDATION_PREFIX}${calendarId}`;
  const value = await redis.get(key);
  return value !== null;
};

export { createSyncLock, invalidateCalendar, isCalendarInvalidated, LOCK_PREFIX, SIGNAL_PREFIX, INVALIDATION_PREFIX, LOCK_TTL_SECONDS, INVALIDATION_TTL_SECONDS, POLL_INTERVAL_MS };
export type { SyncLockHandle, SyncLockRedis, InvalidationRedis, AcquireSyncLockResult, SyncLockSkippedResult };
