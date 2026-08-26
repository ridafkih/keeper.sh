const DELETED_USER_TOMBSTONE_TTL_SECONDS = 3600;
const TOMBSTONE_WRITE_ATTEMPTS = 3;
const TOMBSTONE_RETRY_DELAY_MS = 25;

const deletedUserTombstoneKey = (userId: string): string => `user:${userId}:deleted`;

interface RedisTombstoneClient {
  del(key: string): Promise<number>;
  exists(key: string): Promise<number>;
  set(key: string, value: string, mode: "EX", ttlSeconds: number): Promise<unknown>;
}

type TombstoneWriter = Pick<RedisTombstoneClient, "exists" | "set">;
type TombstoneEraser = Pick<RedisTombstoneClient, "del" | "exists">;

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

const writeTombstoneOnce = async (redis: TombstoneWriter, key: string): Promise<void> => {
  await redis.set(key, String(Date.now()), "EX", DELETED_USER_TOMBSTONE_TTL_SECONDS);

  const written = await redis.exists(key);

  if (written <= 0) {
    throw new Error(`Tombstone ${key} was not present when read back after a successful write`);
  }
};

const markUserDeleted = async (redis: TombstoneWriter, userId: string): Promise<void> => {
  const key = deletedUserTombstoneKey(userId);
  const failures: string[] = [];

  for (let attempt = 1; attempt <= TOMBSTONE_WRITE_ATTEMPTS; attempt += 1) {
    try {
      await writeTombstoneOnce(redis, key);
      return;
    } catch (error) {
      failures.push(`attempt ${attempt}: ${describeFailure(error)}`);
    }

    if (attempt < TOMBSTONE_WRITE_ATTEMPTS) {
      await delay(TOMBSTONE_RETRY_DELAY_MS * attempt);
    }
  }

  throw new Error(
    `Failed to establish the deletion tombstone for user ${userId} — ${failures.join("; ")}`,
  );
};

const eraseTombstoneOnce = async (redis: TombstoneEraser, key: string): Promise<void> => {
  await redis.del(key);

  const remaining = await redis.exists(key);

  if (remaining > 0) {
    throw new Error(`Tombstone ${key} was still present when read back after a successful delete`);
  }
};

const clearUserDeleted = async (redis: TombstoneEraser, userId: string): Promise<void> => {
  const key = deletedUserTombstoneKey(userId);
  const failures: string[] = [];

  for (let attempt = 1; attempt <= TOMBSTONE_WRITE_ATTEMPTS; attempt += 1) {
    try {
      await eraseTombstoneOnce(redis, key);
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

interface UserDeletedFallback {
  isUserRowPresent: () => Promise<boolean>;
  onProbeError?: (error: unknown) => void;
}

const createUserDeletedCheck = (
  redis: Pick<RedisTombstoneClient, "exists">,
  userId: string,
  fallback?: UserDeletedFallback,
): (() => Promise<boolean>) => {
  const key = deletedUserTombstoneKey(userId);
  let latestUserRowAnswer: UserRowAnswer = "unobserved";
  let userRowProbeInFlight: Promise<boolean> | null = null;

  const reportProbeError = (error: unknown): void => {
    fallback?.onProbeError?.(error);
  };

  const runUserRowProbe = async (probe: UserDeletedFallback): Promise<boolean> => {
    try {
      const present = await probe.isUserRowPresent();

      if (present) {
        latestUserRowAnswer = "present";
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

    return await (userRowProbeInFlight ?? startUserRowProbe(probe));
  };

  const isTombstonePresent = async (): Promise<boolean> => {
    try {
      return (await redis.exists(key)) > 0;
    } catch (error) {
      reportProbeError(error);
      return false;
    }
  };

  return async () => {
    const tombstoned = await isTombstonePresent();

    if (tombstoned) {
      return true;
    }

    if (!fallback) {
      return false;
    }

    return await isUserRowAbsent(fallback);
  };
};

export {
  clearUserDeleted,
  createUserDeletedCheck,
  deletedUserTombstoneKey,
  markUserDeleted,
  DELETED_USER_TOMBSTONE_TTL_SECONDS,
};
export type { RedisTombstoneClient, TombstoneEraser, TombstoneWriter, UserDeletedFallback };
