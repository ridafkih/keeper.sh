import type { IcsRecurrenceRule, IcsTimezone, IcsTimezoneProp } from "ts-ics";
import { normalizeTimezone } from "./normalize-timezone";
import {
  findTimeZoneTransitions,
  getTimeZoneOffsetMinutes,
} from "./timezone-instant";
import type { TimeZoneTransition } from "./timezone-instant";

const MS_PER_MINUTE = 60 * 1000;
const MINUTES_PER_HOUR = 60;
const PROJECTION_YEARS_AFTER_REFERENCE = 100;
const PROJECTION_YEARS_BEFORE_REFERENCE = 1;
const DAYS_OF_WEEK = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const vtimezoneCache = new Map<string, IcsTimezone>();

const padTwo = (value: number): string => Math.trunc(value).toString().padStart(2, "0");

const formatOffset = (minutes: number): string => {
  let sign = "+";
  if (minutes < 0) {
    sign = "-";
  }
  const absolute = Math.abs(minutes);
  return `${sign}${padTwo(Math.floor(absolute / MINUTES_PER_HOUR))}${padTwo(absolute % MINUTES_PER_HOUR)}`;
};

const buildBaselineObservance = (
  firstWallTime: Date,
  offsetMinutes: number,
): IcsTimezoneProp => {
  const offset = formatOffset(offsetMinutes);
  return {
    type: "STANDARD",
    start: new Date(firstWallTime.getTime() - offsetMinutes * MS_PER_MINUTE),
    offsetFrom: offset,
    offsetTo: offset,
  };
};

const buildTransitionObservance = (transition: TimeZoneTransition): IcsTimezoneProp => {
  const localOnset = transition.instant.getTime()
    + transition.offsetFromMinutes * MS_PER_MINUTE;
  const generatorStart = localOnset - transition.offsetToMinutes * MS_PER_MINUTE;
  let type: IcsTimezoneProp["type"] = "STANDARD";
  if (transition.offsetToMinutes > transition.offsetFromMinutes) {
    type = "DAYLIGHT";
  }
  return {
    type,
    start: new Date(generatorStart),
    offsetFrom: formatOffset(transition.offsetFromMinutes),
    offsetTo: formatOffset(transition.offsetToMinutes),
  };
};

const getDaysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

const getWeekdayOccurrence = (localOnset: Date): number => {
  const dayOfMonth = localOnset.getUTCDate();
  if (dayOfMonth + DAYS_OF_WEEK.length > getDaysInMonth(
    localOnset.getUTCFullYear(),
    localOnset.getUTCMonth(),
  )) {
    return -1;
  }
  return Math.floor((dayOfMonth - 1) / DAYS_OF_WEEK.length) + 1;
};

const getLocalOnset = (transition: TimeZoneTransition): Date =>
  new Date(transition.instant.getTime() + transition.offsetFromMinutes * MS_PER_MINUTE);

const getTransitionPattern = (transition: TimeZoneTransition): string => {
  const localOnset = getLocalOnset(transition);
  return JSON.stringify([
    transition.offsetFromMinutes,
    transition.offsetToMinutes,
    localOnset.getUTCMonth(),
    localOnset.getUTCDay(),
    getWeekdayOccurrence(localOnset),
    localOnset.getUTCHours(),
    localOnset.getUTCMinutes(),
    localOnset.getUTCSeconds(),
  ]);
};

const groupStableAnnualTransitions = (
  transitions: TimeZoneTransition[],
  firstYear: number,
  finalYear: number,
): TimeZoneTransition[][] | undefined => {
  const groups = new Map<string, TimeZoneTransition[]>();
  for (const transition of transitions) {
    const pattern = getTransitionPattern(transition);
    const matchingTransitions = groups.get(pattern) ?? [];
    matchingTransitions.push(transition);
    groups.set(pattern, matchingTransitions);
  }

  if (groups.size !== 2) {
    return;
  }
  const expectedYears = finalYear - firstYear + 1;
  const groupedTransitions = [...groups.values()];
  if (groupedTransitions.some((group) => group.length !== expectedYears)) {
    return;
  }

  for (const group of groupedTransitions) {
    const observedYears = new Set(group.map((transition) => getLocalOnset(transition).getUTCFullYear()));
    for (let year = firstYear; year <= finalYear; year += 1) {
      if (!observedYears.has(year)) {
        return;
      }
    }
  }
  return groupedTransitions;
};

const buildAnnualRecurrenceRule = (transition: TimeZoneTransition): IcsRecurrenceRule => {
  const localOnset = getLocalOnset(transition);
  const weekday = DAYS_OF_WEEK[localOnset.getUTCDay()];
  if (!weekday) {
    throw new RangeError(`Unable to resolve transition weekday for ${localOnset.toISOString()}`);
  }
  return {
    frequency: "YEARLY",
    byMonth: [localOnset.getUTCMonth()],
    byDay: [{
      day: weekday,
      occurrence: getWeekdayOccurrence(localOnset),
    }],
  };
};

const buildRecurringObservance = (transition: TimeZoneTransition): IcsTimezoneProp => ({
  ...buildTransitionObservance(transition),
  recurrenceRule: buildAnnualRecurrenceRule(transition),
});

const isValidTimeZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
};

const buildVtimezone = (timezone: string | undefined, referenceInstant: Date): IcsTimezone | undefined => {
  const resolved = normalizeTimezone(timezone);
  if (!resolved || !isValidTimeZone(resolved) || Number.isNaN(referenceInstant.getTime())) {
    return;
  }

  const referenceYear = referenceInstant.getUTCFullYear();
  const currentYear = new Date().getUTCFullYear();
  const projectionBaseYear = Math.max(referenceYear, currentYear);
  const cacheKey = `${resolved}|${referenceYear}|${projectionBaseYear}`;
  const cached = vtimezoneCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const firstYear = referenceYear - PROJECTION_YEARS_BEFORE_REFERENCE;
  const finalYear = projectionBaseYear + PROJECTION_YEARS_AFTER_REFERENCE;
  const start = new Date(Date.UTC(firstYear, 0, 1));
  const end = new Date(Date.UTC(finalYear + 1, 0, 1));
  const firstWallTime = new Date(Date.UTC(firstYear, 0, 1));
  const initialOffset = getTimeZoneOffsetMinutes(start, resolved);
  const transitions = findTimeZoneTransitions(resolved, start, end);
  const recurringTransitions = groupStableAnnualTransitions(
    transitions,
    firstYear,
    finalYear,
  );
  const transitionObservances: IcsTimezoneProp[] = [];
  if (recurringTransitions) {
    for (const [first] of recurringTransitions) {
      if (first) {
        transitionObservances.push(buildRecurringObservance(first));
      }
    }
  } else {
    for (const transition of transitions) {
      transitionObservances.push(buildTransitionObservance(transition));
    }
  }
  if (transitionObservances.length === 0) {
    transitionObservances.push(buildBaselineObservance(firstWallTime, initialOffset));
  }

  const builtTimezone: IcsTimezone = {
    id: resolved,
    props: transitionObservances,
  };
  vtimezoneCache.set(cacheKey, builtTimezone);
  return builtTimezone;
};

export { buildVtimezone };
