const DELETED_USER_TOMBSTONE_TTL_SECONDS = 3600;
const TOMBSTONE_WRITE_ATTEMPTS = 3;
const TOMBSTONE_RETRY_DELAY_MS = 25;
const TOMBSTONE_ERASE_CONFIRMATIONS = 3;
const TOMBSTONE_ERASE_CONFIRMATION_DELAY_MS = 25;
const PRESENT_ANSWER_FRESHNESS_MS = 30_000;

const deletedUserTombstoneKey = (userId: string): string => `user:${userId}:deleted`;

const unconfirmedDeletionMarkerKey = (userId: string): string =>
  `${deletedUserTombstoneKey(userId)}:unconfirmed`;

interface RedisTombstoneClient {
  del(key: string): Promise<number>;
  exists(key: string): Promise<number>;
  set(key: string, value: string, mode: "EX", ttlSeconds: number): Promise<unknown>;
}

type TombstoneWriter = Pick<RedisTombstoneClient, "exists" | "set">;
type TombstoneEraser = Pick<RedisTombstoneClient, "del" | "exists">;

interface TombstoneOptions {
  signal?: AbortSignal;
}

const delay = (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

const describeFailure = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const throwIfAborted = (
  signal: AbortSignal | undefined,
  action: string,
  userId: string,
  failures: string[],
): void => {
  if (signal?.aborted !== true) {
    return;
  }

  const summary = `Aborted the ${action} for user ${userId}: ${describeFailure(signal.reason)}`;

  if (failures.length === 0) {
    throw new Error(summary);
  }

  throw new Error(`${summary} — ${failures.join("; ")}`);
};

const writeTombstoneOnce = async (redis: TombstoneWriter, key: string): Promise<void> => {
  await redis.set(key, String(Date.now()), "EX", DELETED_USER_TOMBSTONE_TTL_SECONDS);

  const written = await redis.exists(key);

  if (written <= 0) {
    throw new Error(`Tombstone ${key} was not present when read back after a successful write`);
  }
};

const establishTombstone = async (
  redis: TombstoneWriter,
  key: string,
  userId: string,
  subject: string,
  options: TombstoneOptions,
): Promise<void> => {
  const failures: string[] = [];

  for (let attempt = 1; attempt <= TOMBSTONE_WRITE_ATTEMPTS; attempt += 1) {
    throwIfAborted(options.signal, `${subject} write`, userId, failures);

    try {
      await writeTombstoneOnce(redis, key);
      return;
    } catch (error) {
      failures.push(`attempt ${attempt}: ${describeFailure(error)}`);
    }

    if (attempt < TOMBSTONE_WRITE_ATTEMPTS) {
      throwIfAborted(options.signal, `${subject} write`, userId, failures);
      await delay(TOMBSTONE_RETRY_DELAY_MS * attempt);
    }
  }

  throw new Error(`Failed to establish the ${subject} for user ${userId} — ${failures.join("; ")}`);
};

const markUserDeleted = (
  redis: TombstoneWriter,
  userId: string,
  options: TombstoneOptions = {},
): Promise<void> =>
  establishTombstone(redis, deletedUserTombstoneKey(userId), userId, "deletion tombstone", options);

const markUserDeletionUnconfirmed = (
  redis: TombstoneWriter,
  userId: string,
  options: TombstoneOptions = {},
): Promise<void> =>
  establishTombstone(
    redis,
    unconfirmedDeletionMarkerKey(userId),
    userId,
    "unconfirmed deletion marker",
    options,
  );

const eraseTombstoneOnce = async (redis: TombstoneEraser, key: string): Promise<void> => {
  await redis.del(key);

  const remaining = await redis.exists(key);

  if (remaining > 0) {
    throw new Error(`Tombstone ${key} was still present when read back after a successful delete`);
  }
};

const eraseTombstoneUntilSettled = async (redis: TombstoneEraser, key: string): Promise<void> => {
  await eraseTombstoneOnce(redis, key);

  for (let confirmation = 1; confirmation <= TOMBSTONE_ERASE_CONFIRMATIONS; confirmation += 1) {
    await delay(TOMBSTONE_ERASE_CONFIRMATION_DELAY_MS);

    if ((await redis.exists(key)) > 0) {
      await eraseTombstoneOnce(redis, key);
    }
  }
};

const clearUserDeleted = async (redis: TombstoneEraser, userId: string): Promise<void> => {
  const keys = [deletedUserTombstoneKey(userId), unconfirmedDeletionMarkerKey(userId)];
  const failures: string[] = [];

  for (let attempt = 1; attempt <= TOMBSTONE_WRITE_ATTEMPTS; attempt += 1) {
    try {
      for (const key of keys) {
        await eraseTombstoneUntilSettled(redis, key);
      }
      return;
    } catch (error) {
      failures.push(`attempt ${attempt}: ${describeFailure(error)}`);
    }

    if (attempt < TOMBSTONE_WRITE_ATTEMPTS) {
      await delay(TOMBSTONE_RETRY_DELAY_MS * attempt);
    }
  }

  throw new Error(
    `Failed to clear the deletion tombstone for user ${userId} — ${failures.join("; ")}`,
  );
};

type UserRowAnswer = "absent" | "present" | "unobserved";

const readClock = (probe: UserDeletedFallback): number => (probe.now ?? Date.now)();

interface UserDeletedFallback {
  isUserRowPresent: () => Promise<boolean>;
  freshnessWindowMs?: number;
  now?: () => number;
  onProbeError?: (error: unknown) => void;
}

const createUserDeletedCheck = (
  redis: Pick<RedisTombstoneClient, "exists">,
  userId: string,
  fallback?: UserDeletedFallback,
): (() => Promise<boolean>) => {
  const key = deletedUserTombstoneKey(userId);
  const unconfirmedKey = unconfirmedDeletionMarkerKey(userId);
  let latestUserRowAnswer: UserRowAnswer = "unobserved";
  let presentAnswerObservedAtMs = 0;
  let userRowProbeInFlight: Promise<boolean> | null = null;

  const presentAnswerIsFresh = (probe: UserDeletedFallback): boolean => {
    if (latestUserRowAnswer !== "present") {
      return false;
    }

    const windowMs = probe.freshnessWindowMs ?? 0;

    return windowMs > 0 && readClock(probe) - presentAnswerObservedAtMs <= windowMs;
  };

  const reportProbeError = (error: unknown): void => {
    fallback?.onProbeError?.(error);
  };

  const runUserRowProbe = async (probe: UserDeletedFallback): Promise<boolean> => {
    try {
      const present = await probe.isUserRowPresent();

      if (present) {
        latestUserRowAnswer = "present";
        presentAnswerObservedAtMs = readClock(probe);
        return false;
      }

      latestUserRowAnswer = "absent";
      return true;
    } catch (error) {
      reportProbeError(error);
      return false;
    } finally {
      userRowProbeInFlight = null;
    }
  };

  const startUserRowProbe = (probe: UserDeletedFallback): Promise<boolean> => {
    const started = runUserRowProbe(probe);
    userRowProbeInFlight = started;
    return started;
  };

  const isUserRowAbsent = async (probe: UserDeletedFallback): Promise<boolean> => {
    if (latestUserRowAnswer === "absent") {
      return true;
    }

    if (presentAnswerIsFresh(probe)) {
      return false;
    }

    return await (userRowProbeInFlight ?? startUserRowProbe(probe));
  };

  const isTombstonePresent = async (): Promise<boolean> => {
    try {
      return (await redis.exists(key)) > 0;
    } catch (error) {
      reportProbeError(error);
      presentAnswerObservedAtMs = 0;
      return false;
    }
  };

  const isProvisional = async (): Promise<boolean> => {
    try {
      return (await redis.exists(unconfirmedKey)) > 0;
    } catch (error) {
      reportProbeError(error);
      return true;
    }
  };

  return async () => {
    const tombstoned = await isTombstonePresent();

    if (tombstoned) {
      if (!fallback) {
        return true;
      }

      if (!(await isProvisional())) {
        return true;
      }

      const absent = await isUserRowAbsent(fallback);

      return absent || latestUserRowAnswer !== "present";
    }

    if (!fallback) {
      return false;
    }

    return await isUserRowAbsent(fallback);
  };
};

export {
  clearUserDeleted,
  PRESENT_ANSWER_FRESHNESS_MS,
  createUserDeletedCheck,
  deletedUserTombstoneKey,
  markUserDeleted,
  markUserDeletionUnconfirmed,
  unconfirmedDeletionMarkerKey,
  DELETED_USER_TOMBSTONE_TTL_SECONDS,
};
export type {
  RedisTombstoneClient,
  TombstoneEraser,
  TombstoneOptions,
  TombstoneWriter,
  UserDeletedFallback,
};
