import type Redis from "ioredis";

const SYNC_TRIGGER_COOLDOWN_SECONDS = 60;
const CALENDAR_REFRESH_COOLDOWN_SECONDS = 60;
const MINIMUM_RETRY_AFTER_SECONDS = 1;

type SyncTriggerLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

const claimCooldown = async (
  redisClient: Redis,
  key: string,
  ttlSeconds: number,
): Promise<SyncTriggerLimitResult> => {
  const claimed = await redisClient.set(key, "1", "EX", ttlSeconds, "NX");

  if (claimed === "OK") {
    return { allowed: true };
  }

  const remainingSeconds = await redisClient.ttl(key);

  return {
    allowed: false,
    retryAfterSeconds: Math.max(remainingSeconds, MINIMUM_RETRY_AFTER_SECONDS),
  };
};

const checkAndClaimSyncTrigger = (
  redisClient: Redis,
  userId: string,
): Promise<SyncTriggerLimitResult> =>
  claimCooldown(redisClient, `sync_trigger:${userId}`, SYNC_TRIGGER_COOLDOWN_SECONDS);

const checkAndClaimCalendarRefresh = (
  redisClient: Redis,
  accountId: string,
): Promise<SyncTriggerLimitResult> =>
  claimCooldown(
    redisClient,
    `refresh_calendars:${accountId}`,
    CALENDAR_REFRESH_COOLDOWN_SECONDS,
  );

export {
  CALENDAR_REFRESH_COOLDOWN_SECONDS,
  SYNC_TRIGGER_COOLDOWN_SECONDS,
  checkAndClaimCalendarRefresh,
  checkAndClaimSyncTrigger,
};
export type { SyncTriggerLimitResult };
