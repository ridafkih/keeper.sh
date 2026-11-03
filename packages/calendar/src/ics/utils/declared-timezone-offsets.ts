import ICAL from "ical.js";
import { wallTimeToInstantWith } from "./timezone-instant";
import type { ZoneOffsetAt } from "./timezone-instant";

interface ObservanceChange {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  prevUtcOffset: number;
}

interface ObservanceExpander {
  _expandComponent: (
    observance: ICAL.Component,
    untilYear: number,
    changes: ObservanceChange[],
  ) => ObservanceChange[] | null;
}

interface ZoneChange {
  instant: number;
  offsetMinutes: number;
  previousOffsetMinutes: number;
}

interface DeclaredZone {
  offsetAt: ZoneOffsetAt;
  wallTimeToInstant: (wallTime: Date) => Date;
}

const OBSERVANCE_NAMES = new Set(["standard", "daylight"]);
const JCAL_VALUE_INDEX = 3;
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const COVERAGE_YEARS_AHEAD = 1;
const JCAL_UTC_OFFSET_PATTERN = /^([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/;

const parseJcalUtcOffset = (value: unknown): number | undefined => {
  if (typeof value !== "string") {
    return;
  }
  const match = JCAL_UTC_OFFSET_PATTERN.exec(value);
  if (!match) {
    return;
  }
  const [, sign, hours, minutes, seconds = "0"] = match;
  const magnitude = Number(hours) * MINUTES_PER_HOUR + Number(minutes) + Number(seconds) / SECONDS_PER_MINUTE;
  if (sign === "-") {
    return -magnitude;
  }
  return magnitude;
};

const readObservanceOffset = (observance: ICAL.Component, name: string): number | undefined =>
  parseJcalUtcOffset(observance.getFirstProperty(name)?.jCal[JCAL_VALUE_INDEX]);

const readTimezoneComponent = (blockText: string): ICAL.Component | undefined => {
  try {
    const jCal: unknown = ICAL.parse(blockText);
    if (!Array.isArray(jCal) || jCal[0] !== "vtimezone") {
      return;
    }
    return new ICAL.Component(jCal);
  } catch {
    return globalThis.undefined;
  }
};

const isUsableObservance = (observance: ICAL.Component): boolean =>
  OBSERVANCE_NAMES.has(observance.name)
  && observance.hasProperty("dtstart")
  && readObservanceOffset(observance, "tzoffsetfrom") !== globalThis.undefined
  && readObservanceOffset(observance, "tzoffsetto") !== globalThis.undefined;

const listUsableObservances = (timezone: ICAL.Component): ICAL.Component[] =>
  timezone.getAllSubcomponents().filter((observance) => isUsableObservance(observance));

const readOnsetYear = (observance: ICAL.Component): number => {
  const onset = observance.getFirstPropertyValue("dtstart");
  if (onset instanceof ICAL.Time) {
    return onset.year;
  }
  return 0;
};

const includeStartAsListedOnset = (observance: ICAL.Component): void => {
  if (!observance.hasProperty("rdate") || observance.hasProperty("rrule")) {
    return;
  }
  observance.addPropertyWithValue("rdate", observance.getFirstPropertyValue("dtstart"));
};

const toZoneChange = (
  change: ObservanceChange,
  offsetMinutes: number,
  previousOffsetMinutes: number,
): ZoneChange => {
  const listedInstant = Date.UTC(
    change.year,
    change.month - 1,
    change.day,
    change.hour,
    change.minute,
    change.second,
  );
  return {
    instant: listedInstant + change.prevUtcOffset * MS_PER_SECOND - previousOffsetMinutes * MS_PER_MINUTE,
    offsetMinutes,
    previousOffsetMinutes,
  };
};

const expandObservance = (
  expander: ObservanceExpander,
  observance: ICAL.Component,
  untilYear: number,
): ZoneChange[] => {
  const offsetMinutes = readObservanceOffset(observance, "tzoffsetto") ?? 0;
  const previousOffsetMinutes = readObservanceOffset(observance, "tzoffsetfrom") ?? 0;
  includeStartAsListedOnset(observance);
  const changes = expander._expandComponent(observance, untilYear, []) ?? [];
  return changes.map((change) => toZoneChange(change, offsetMinutes, previousOffsetMinutes));
};

const expandZoneChanges = (blockText: string, untilYear: number): ZoneChange[] => {
  const timezone = readTimezoneComponent(blockText);
  if (!timezone) {
    throw new RangeError("Unable to read declared VTIMEZONE");
  }
  const expander: ObservanceExpander = new ICAL.Timezone({ component: timezone });
  try {
    return listUsableObservances(timezone)
      .flatMap((observance) => expandObservance(expander, observance, untilYear))
      .toSorted((left, right) => left.instant - right.instant);
  } catch (error) {
    throw new RangeError("Unable to expand declared VTIMEZONE", { cause: error });
  }
};

const findLastChangeIndexAtOrBefore = (changes: readonly ZoneChange[], instant: number): number => {
  let lower = 0;
  let upper = changes.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    const change = changes[middle];
    if (change && change.instant <= instant) {
      lower = middle + 1;
    } else {
      upper = middle;
    }
  }
  return lower - 1;
};

const offsetBeforeChange = (changes: readonly ZoneChange[], index: number): number =>
  changes[index - 1]?.offsetMinutes ?? changes[index]?.previousOffsetMinutes ?? 0;

const createDeclaredZone = (blockText: string, latestOnsetYear: number): DeclaredZone => {
  let coveredUntilYear = Number.NEGATIVE_INFINITY;
  let changes: ZoneChange[] = [];

  const coverChanges = (instant: number): readonly ZoneChange[] => {
    const year = new Date(instant).getUTCFullYear() + COVERAGE_YEARS_AHEAD;
    if (year > coveredUntilYear) {
      coveredUntilYear = Math.max(year, latestOnsetYear);
      changes = expandZoneChanges(blockText, coveredUntilYear);
    }
    return changes;
  };

  const offsetAt: ZoneOffsetAt = (instant) => {
    const covered = coverChanges(instant.getTime());
    const index = findLastChangeIndexAtOrBefore(covered, instant.getTime());
    if (index < 0) {
      return covered[0]?.previousOffsetMinutes ?? 0;
    }
    return covered[index]?.offsetMinutes ?? 0;
  };

  const countTransitionsBetween = (from: number, to: number): number => {
    const covered = coverChanges(to);
    const first = findLastChangeIndexAtOrBefore(covered, from) + 1;
    const last = findLastChangeIndexAtOrBefore(covered, to);
    let count = 0;
    for (let index = first; index <= last; index += 1) {
      if (covered[index]?.offsetMinutes !== offsetBeforeChange(covered, index)) {
        count += 1;
      }
    }
    return count;
  };

  const wallTimeToInstant = (wallTime: Date): Date => {
    const wall = wallTime.getTime();
    if (countTransitionsBetween(wall - MS_PER_DAY, wall + MS_PER_DAY) > 1) {
      throw new RangeError(`Declared VTIMEZONE changes offset twice around ${wallTime.toISOString()}`);
    }
    return wallTimeToInstantWith(wallTime, offsetAt);
  };

  return { offsetAt, wallTimeToInstant };
};

const readDeclaredZone = (blockText: string): DeclaredZone | undefined => {
  const timezone = readTimezoneComponent(blockText);
  if (!timezone) {
    return;
  }
  const observances = listUsableObservances(timezone);
  if (observances.length === 0) {
    return;
  }
  return createDeclaredZone(blockText, Math.max(...observances.map((observance) => readOnsetYear(observance))));
};

const declaredZoneOffsetAt = (blockText: string): ZoneOffsetAt | undefined =>
  readDeclaredZone(blockText)?.offsetAt;

export { declaredZoneOffsetAt, readDeclaredZone };
export type { DeclaredZone };
