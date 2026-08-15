const LOCK_PREFIX = "sync:lock:";
const SIGNAL_PREFIX = "sync:signal:";
const WAITER_PREFIX = "sync:waiters:";
const LOCK_TTL_SECONDS = 120;
const LOCK_RENEW_INTERVAL_MS = (LOCK_TTL_SECONDS * 1000) / 3;
const SIGNAL_TTL_SECONDS = 320;
const POLL_INTERVAL_MS = 250;
const POLL_TIMEOUT_MS = 310_000;
const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
const MAPPING_MUTATION_LOCK_PREFIX = "mapping-mutation:";
const BACKGROUND_HOLDER_PREFIX = "background:";
const PREEMPTING_HOLDER_PREFIX = "preempting:";

/**
 * Supersession means "a waiter needs the holder to stop", not "a waiter exists".
 * A routine background sync queued behind an identical run is not a reason to
 * abandon reads already paid for; a mapping mutation is. The class rides inside
 * the holder id because every script here compares holder ids as opaque strings.
 * An unprefixed id from an older deployment is treated as preempting.
 */
type SyncLockAcquisition = "background" | "preempting";

const HOLDER_PREFIXES: Record<SyncLockAcquisition, string> = {
  background: BACKGROUND_HOLDER_PREFIX,
  preempting: PREEMPTING_HOLDER_PREFIX,
};

interface SyncLockRedis {
  get: (key: string) => Promise<string | null>;
  eval: (script: string, keyCount: number, ...args: string[]) => Promise<unknown>;
}

interface SyncLockHandle {
  isHeld: () => Promise<boolean>;
  isCurrent: () => Promise<boolean>;
  release: () => Promise<void>;
}

class SyncLockRenewalError extends Error {
  public readonly calendarId: string;

  public constructor(calendarId: string, cause: unknown) {
    super(`Failed to renew sync lock for calendar ${calendarId}`, { cause });
    this.name = "SyncLockRenewalError";
    this.calendarId = calendarId;
  }
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
 * KEYS[3] = optional blocker lock key
 * KEYS[4] = waiter stack key
 * ARGV[1] = holder ID
 * ARGV[2] = lock TTL in seconds
 * ARGV[3] = waiter signal TTL in seconds
 * ARGV[4] = whether the blocker key should be checked
 *
 * Returns:
 *   "acquired"  — lock was free, caller now holds it
 *   "blocked"   — a higher-priority mutation lock is held
 *   "queued"    — lock was held, caller is now the pending waiter
 *   "replaced"  — lock was held and there was already a waiter; old waiter replaced
 */
const ACQUIRE_OR_SIGNAL_SCRIPT = `
  if ARGV[4] == '1' and redis.call('EXISTS', KEYS[3]) == 1 then
    return 'blocked'
  end
  local lock = redis.call('GET', KEYS[1])
  local existing = redis.call('GET', KEYS[2])
  redis.call('LREM', KEYS[4], 0, ARGV[1])
  redis.call('LPUSH', KEYS[4], ARGV[1])
  redis.call('EXPIRE', KEYS[4], ARGV[3])
  redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[3])

  if not lock then
    redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
    return 'acquired'
  end

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

const RENEW_SCRIPT = `
  local holder = redis.call('GET', KEYS[1])
  if holder == ARGV[1] then
    redis.call('EXPIRE', KEYS[1], ARGV[2])
    return 1
  end
  return 0
`;

/**
 * Remove this caller from the waiter stack and atomically promote the previous
 * live waiter when needed. This preserves a valid predecessor when a newer
 * request is cancelled after replacing it.
 */
const CANCEL_WAITER_SCRIPT = `
  local holder = redis.call('GET', KEYS[3])
  if holder == ARGV[1] then
    redis.call('DEL', KEYS[3])
  end
  redis.call('LREM', KEYS[2], 0, ARGV[1])
  local waiter = redis.call('LINDEX', KEYS[2], 0)
  if waiter then
    redis.call('SET', KEYS[1], waiter, 'EX', ARGV[2])
    redis.call('EXPIRE', KEYS[2], ARGV[2])
    return waiter
  end
  redis.call('DEL', KEYS[1])
  redis.call('DEL', KEYS[2])
  return ''
`;

/**
 * Commit an acquisition only if the caller still owns the lock. Until this
 * confirmation, predecessor waiters remain available for cancellation
 * handoff if the abort signal fires while the acquire EVAL is in flight.
 */
const CONFIRM_ACQUISITION_SCRIPT = `
  local holder = redis.call('GET', KEYS[1])
  local signal = redis.call('GET', KEYS[2])
  local waiter = redis.call('LINDEX', KEYS[3], 0)
  if holder == ARGV[1] and signal == ARGV[1] and waiter == ARGV[1] then
    redis.call('DEL', KEYS[2])
    redis.call('DEL', KEYS[3])
    return 1
  end
  return 0
`;

/**
 * Report whether the caller is still the current holder.
 *
 * KEYS[1] = lock key
 * KEYS[2] = waiter stack key
 * ARGV[1] = holder ID
 *
 * The waiter stack is read rather than the signal key because
 * ACQUIRE_OR_SIGNAL_SCRIPT overwrites the signal on every new waiter, so a
 * preempting waiter is masked there as soon as a background one arrives behind it.
 */
const IS_CURRENT_SCRIPT = `
  local holder = redis.call('GET', KEYS[1])
  if holder ~= ARGV[1] then
    return 0
  end
  local prefix = '${BACKGROUND_HOLDER_PREFIX}'
  local waiters = redis.call('LRANGE', KEYS[2], 0, -1)
  for index = 1, #waiters do
    local waiter = waiters[index]
    if waiter ~= ARGV[1] and string.sub(waiter, 1, #prefix) ~= prefix then
      return 0
    end
  end
  return 1
`;

const createLockHandle = (
  redis: SyncLockRedis,
  calendarId: string,
  lockKey: string,
  waiterKey: string,
  holderId: string,
): SyncLockHandle => {
  const renewalState: { error?: unknown } = {};
  const renewalTimer = setInterval(async () => {
    try {
      await redis.eval(RENEW_SCRIPT, 1, lockKey, holderId, String(LOCK_TTL_SECONDS));
      /*
       * A later success proves the lease is still ours, so a single blip must not
       * strand the run. Losing the lock for real surfaces through isHeld/isCurrent
       * reading a different holder, not through this flag.
       */
      delete renewalState.error;
    } catch (error) {
      renewalState.error = error;
    }
  }, LOCK_RENEW_INTERVAL_MS);

  const throwIfRenewalFailed = (): void => {
    if ("error" in renewalState) {
      throw new SyncLockRenewalError(calendarId, renewalState.error);
    }
  };

  const isHeld = async (): Promise<boolean> => {
    throwIfRenewalFailed();
    return await redis.get(lockKey) === holderId;
  };

  const isCurrent = async (): Promise<boolean> => {
    throwIfRenewalFailed();

    const current = await redis.eval(
      IS_CURRENT_SCRIPT,
      2,
      lockKey,
      waiterKey,
      holderId,
    );

    return current === 1;
  };

  const release = async (): Promise<void> => {
    clearInterval(renewalTimer);
    await redis.eval(RELEASE_SCRIPT, 1, lockKey, holderId);
  };

  return { isCurrent, isHeld, release };
};

const createSyncLock = (
  redis: SyncLockRedis,
  acquisition: SyncLockAcquisition = "preempting",
) => {
  const acquire = async (
    calendarId: string,
    abortSignal?: AbortSignal,
    blockerCalendarId?: string,
  ): Promise<AcquireSyncLockResult | SyncLockSkippedResult> => {
    const lockKey = `${LOCK_PREFIX}${calendarId}`;
    const signalKey = `${SIGNAL_PREFIX}${calendarId}`;
    const waiterKey = `${WAITER_PREFIX}${calendarId}`;
    const blockerLockKey = `${LOCK_PREFIX}${blockerCalendarId ?? calendarId}`;
    const holderId = `${HOLDER_PREFIXES[acquisition]}${crypto.randomUUID()}`;
    let checkBlocker = "0";
    if (blockerCalendarId) {
      checkBlocker = "1";
    }

    if (abortSignal?.aborted) {
      return { acquired: false };
    }

    const cancelWaiter = async (): Promise<void> => {
      await redis.eval(
        CANCEL_WAITER_SCRIPT,
        3,
        signalKey,
        waiterKey,
        lockKey,
        holderId,
        String(SIGNAL_TTL_SECONDS),
      );
    };

    const createConfirmedHandle = async (): Promise<SyncLockHandle | null> => {
      if (abortSignal?.aborted) {
        await cancelWaiter();
        return null;
      }
      const confirmed = await redis.eval(
        CONFIRM_ACQUISITION_SCRIPT,
        3,
        lockKey,
        signalKey,
        waiterKey,
        holderId,
      );
      if (confirmed !== 1) {
        await cancelWaiter();
        return null;
      }
      return createLockHandle(
        redis,
        calendarId,
        lockKey,
        waiterKey,
        holderId,
      );
    };

    const createConfirmedResult = async (): Promise<
      AcquireSyncLockResult | SyncLockSkippedResult
    > => {
      const handle = await createConfirmedHandle();
      if (!handle) {
        return { acquired: false };
      }
      return { acquired: true, handle };
    };

    let result = await redis.eval(
      ACQUIRE_OR_SIGNAL_SCRIPT,
      4,
      lockKey,
      signalKey,
      blockerLockKey,
      waiterKey,
      holderId,
      String(LOCK_TTL_SECONDS),
      String(SIGNAL_TTL_SECONDS),
      checkBlocker,
    );

    if (result === "acquired") {
      return await createConfirmedResult();
    }

    const pollDeadline = Date.now() + POLL_TIMEOUT_MS;
    let acquired = false;

    try {
      while (Date.now() < pollDeadline) {
        if (abortSignal?.aborted) {
          return { acquired: false };
        }

        if (result !== "blocked") {
          const currentWaiter = await redis.get(signalKey);
          if (currentWaiter === null) {
            return { acquired: false };
          }
          if (currentWaiter !== holderId) {
            await sleep(POLL_INTERVAL_MS);
            continue;
          }
        }

        const lockHolder = await redis.get(lockKey);
        if (result === "blocked" || !lockHolder) {
          result = await redis.eval(
            ACQUIRE_OR_SIGNAL_SCRIPT,
            4,
            lockKey,
            signalKey,
            blockerLockKey,
            waiterKey,
            holderId,
            String(LOCK_TTL_SECONDS),
            String(SIGNAL_TTL_SECONDS),
            checkBlocker,
          );

          if (result === "acquired") {
            const confirmedResult = await createConfirmedResult();
            const { acquired: acquisitionConfirmed } = confirmedResult;
            acquired = acquisitionConfirmed;
            return confirmedResult;
          }
        }

        await sleep(POLL_INTERVAL_MS);
      }

      return { acquired: false };
    } finally {
      if (!acquired) {
        await cancelWaiter();
      }
    }
  };

  return { acquire };
};

const createMappingMutationLockId = (userId: string): string =>
  `${MAPPING_MUTATION_LOCK_PREFIX}${userId}`;

export { createSyncLock, createMappingMutationLockId, SyncLockRenewalError, LOCK_PREFIX, SIGNAL_PREFIX, WAITER_PREFIX, LOCK_TTL_SECONDS, LOCK_RENEW_INTERVAL_MS, POLL_INTERVAL_MS, BACKGROUND_HOLDER_PREFIX };
export type { SyncLockAcquisition, SyncLockHandle, SyncLockRedis, AcquireSyncLockResult, SyncLockSkippedResult };
