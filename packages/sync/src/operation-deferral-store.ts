import type { OperationDeferralLedger } from "@keeper.sh/calendar";
import { SYNC_DEFERRED_OPERATION_TTL_SECONDS } from "@keeper.sh/constants";

const DEFERRED_OPERATIONS_KEY_PREFIX = "sync:deferred-operations:";

interface OperationDeferralRedis {
  expire: (key: string, seconds: number) => Promise<unknown>;
  sadd: (key: string, ...members: string[]) => Promise<unknown>;
  smembers: (key: string) => Promise<string[]>;
  srem: (key: string, ...members: string[]) => Promise<unknown>;
}

const createRedisOperationDeferralLedger = (
  redis: OperationDeferralRedis,
  destinationCalendarId: string,
): OperationDeferralLedger => {
  const key = `${DEFERRED_OPERATIONS_KEY_PREFIX}${destinationCalendarId}`;

  return {
    readDeferredOperationKeys: async () => new Set(await redis.smembers(key)),
    recordOperationOutcomes: async ({ failed, succeeded }) => {
      if (succeeded.length > 0) {
        await redis.srem(key, ...succeeded);
      }
      if (failed.length > 0) {
        await redis.sadd(key, ...failed);
        await redis.expire(key, SYNC_DEFERRED_OPERATION_TTL_SECONDS);
      }
    },
  };
};

export { createRedisOperationDeferralLedger };
