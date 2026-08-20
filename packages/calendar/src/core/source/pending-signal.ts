import { PENDING_SIGNAL_KEY } from "./push-keys";

/*
 * A producer must stay safe when its consumer is absent — one shipped without the other
 * during rollout and the list grew unread. Dropping the oldest is the right loss: the
 * sorted set still holds every calendar, so a dropped nudge costs the periodic tick's
 * latency and nothing else, where an unbounded list costs Redis.
 */
const PENDING_SIGNAL_MAX_LENGTH = 10_000;
const PENDING_SIGNAL_TTL_SECONDS = 3600;

interface PendingSignalRedis {
  expire: (key: string, seconds: number) => Promise<unknown>;
  ltrim: (key: string, start: number, stop: number) => Promise<unknown>;
  rpush: (key: string, ...values: string[]) => Promise<unknown>;
}

const signalPendingCalendars = async (
  redis: PendingSignalRedis,
  calendarIds: string[],
): Promise<void> => {
  if (calendarIds.length === 0) {
    return;
  }
  await redis.rpush(PENDING_SIGNAL_KEY, ...calendarIds);
  await redis.ltrim(PENDING_SIGNAL_KEY, -PENDING_SIGNAL_MAX_LENGTH, -1);
  await redis.expire(PENDING_SIGNAL_KEY, PENDING_SIGNAL_TTL_SECONDS);
};

export { PENDING_SIGNAL_MAX_LENGTH, PENDING_SIGNAL_TTL_SECONDS, signalPendingCalendars };
export type { PendingSignalRedis };
