import type { CalendarInfo } from "../types";

const CALDAV_DISCOVERY_TTL_SECONDS = 900;

const buildDiscoveryCacheKey = (accountId: string): string => `caldav:calendars:${accountId}`;

interface CalendarDiscoveryCache {
  read: () => Promise<CalendarInfo[] | null>;
  write: (calendars: CalendarInfo[]) => Promise<void>;
}

interface DiscoveryCacheRedis {
  get: (key: string) => Promise<string | null>;
  setex: (key: string, seconds: number, value: string) => Promise<unknown>;
}

interface DiscoveryCacheDeleter {
  del: (...keys: string[]) => Promise<number>;
}

const isCalendarInfo = (value: unknown): value is CalendarInfo => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.url === "string" && typeof candidate.displayName === "string";
};

const parseCachedCalendars = (payload: string | null): CalendarInfo[] | null => {
  if (payload === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!Array.isArray(parsed) || !parsed.every((entry) => isCalendarInfo(entry))) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const createCalendarDiscoveryCache = (
  redis: DiscoveryCacheRedis,
  accountId: string,
): CalendarDiscoveryCache => {
  const key = buildDiscoveryCacheKey(accountId);
  /*
   * A cache that cannot be reached costs a walk, which is what the walk cost before this
   * existed. Letting Redis fail an ingest would make the optimisation the weakest link.
   */
  return {
    read: async () => {
      try {
        return parseCachedCalendars(await redis.get(key));
      } catch {
        return null;
      }
    },
    write: async (calendars) => {
      await redis
        .setex(key, CALDAV_DISCOVERY_TTL_SECONDS, JSON.stringify(calendars))
        .catch(() => null);
    },
  };
};

const invalidateCalendarDiscoveryCache = async (
  redis: DiscoveryCacheDeleter,
  accountId: string,
): Promise<void> => {
  await redis.del(buildDiscoveryCacheKey(accountId));
};

export {
  buildDiscoveryCacheKey,
  CALDAV_DISCOVERY_TTL_SECONDS,
  createCalendarDiscoveryCache,
  invalidateCalendarDiscoveryCache,
  parseCachedCalendars,
};
export type { CalendarDiscoveryCache, DiscoveryCacheDeleter, DiscoveryCacheRedis };
