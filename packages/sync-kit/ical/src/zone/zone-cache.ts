import type { VtimezoneBlock } from "./build-vtimezone";

interface ZoneCounters {
  offsetProbes: number;
  formatterConstructions: number;
  projectedYears: number;
}

interface ZoneCache {
  readonly kind: "zoneCache";
  readonly wallClockFormatters: Map<string, Intl.DateTimeFormat>;
  readonly weekdayFormatters: Map<string, Intl.DateTimeFormat>;
  readonly vtimezones: Map<string, VtimezoneBlock>;
  readonly counters: ZoneCounters;
}

interface ZoneCacheStatistics {
  readonly offsetProbes: number;
  readonly formatterConstructions: number;
  readonly projectedYears: number;
}

const createZoneCache = (): ZoneCache => ({
  kind: "zoneCache",
  wallClockFormatters: new Map(),
  weekdayFormatters: new Map(),
  vtimezones: new Map(),
  counters: { offsetProbes: 0, formatterConstructions: 0, projectedYears: 0 },
});

const zoneCacheStatistics = (zones: ZoneCache): ZoneCacheStatistics => ({
  offsetProbes: zones.counters.offsetProbes,
  formatterConstructions: zones.counters.formatterConstructions,
  projectedYears: zones.counters.projectedYears,
});

const countedFormatter = (
  zones: ZoneCache,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat => {
  zones.counters.formatterConstructions += 1;
  return new Intl.DateTimeFormat(locale, options);
};

const wallClockFormatter = (zones: ZoneCache, zoneValue: string): Intl.DateTimeFormat => {
  const cached = zones.wallClockFormatters.get(zoneValue);
  if (cached) {
    return cached;
  }
  const created = countedFormatter(zones, "sv-SE", {
    timeZone: zoneValue,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  zones.wallClockFormatters.set(zoneValue, created);
  return created;
};

const weekdayFormatter = (zones: ZoneCache, zoneValue: string): Intl.DateTimeFormat => {
  const cached = zones.weekdayFormatters.get(zoneValue);
  if (cached) {
    return cached;
  }
  const created = countedFormatter(zones, "en-US", { timeZone: zoneValue, weekday: "short" });
  zones.weekdayFormatters.set(zoneValue, created);
  return created;
};

export { countedFormatter, createZoneCache, wallClockFormatter, weekdayFormatter, zoneCacheStatistics };
export type { ZoneCache, ZoneCacheStatistics };
