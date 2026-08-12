import type Redis from "ioredis";

const SYNC_TRIGGER_COOLDOWN_SECONDS = 60;

const buildCooldownKey = (userId: string): string => `sync_trigger:${userId}`;

type SyncTriggerLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

const checkAndClaimSyncTrigger = async (
  redisClient: Redis,
  userId: string,
): Promise<SyncTriggerLimitResult> => {
  const key = buildCooldownKey(userId);
  const claimed = await redisClient.set(key, "1", "EX", SYNC_TRIGGER_COOLDOWN_SECONDS, "NX");

  if (claimed === "OK") {
    return { allowed: true };
  }

  const remainingSeconds = await redisClient.ttl(key);

  return {
    allowed: false,
    retryAfterSeconds: Math.max(remainingSeconds, 1),
  };
};

export { checkAndClaimSyncTrigger, SYNC_TRIGGER_COOLDOWN_SECONDS };
export type { SyncTriggerLimitResult };
