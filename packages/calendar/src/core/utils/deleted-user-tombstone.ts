const DELETED_USER_TOMBSTONE_TTL_SECONDS = 3600;

const deletedUserTombstoneKey = (userId: string): string => `user:${userId}:deleted`;

interface RedisTombstoneClient {
  exists(key: string): Promise<number>;
  set(key: string, value: string, mode: "EX", ttlSeconds: number): Promise<unknown>;
}

const markUserDeleted = async (
  redis: Pick<RedisTombstoneClient, "set">,
  userId: string,
): Promise<void> => {
  await redis.set(
    deletedUserTombstoneKey(userId),
    String(Date.now()),
    "EX",
    DELETED_USER_TOMBSTONE_TTL_SECONDS,
  );
};

const createUserDeletedCheck = (
  redis: Pick<RedisTombstoneClient, "exists">,
  userId: string,
): (() => Promise<boolean>) => {
  const key = deletedUserTombstoneKey(userId);
  return async () => (await redis.exists(key)) > 0;
};

export {
  createUserDeletedCheck,
  deletedUserTombstoneKey,
  markUserDeleted,
  DELETED_USER_TOMBSTONE_TTL_SECONDS,
};
export type { RedisTombstoneClient };
