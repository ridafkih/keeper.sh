import type { IcsRecurrenceRule, IcsTimezone, IcsTimezoneProp } from "ts-ics";
import { normalizeTimezone } from "./normalize-timezone";
import {
  findTimeZoneTransitions,
  formatIcsUtcOffset,
  getTimeZoneOffsetMinutes,
  isSupportedTimeZone,
} from "./timezone-instant";
import type { TimeZoneTransition } from "./timezone-instant";

const MS_PER_MINUTE = 60 * 1000;
const PROJECTION_YEARS_AFTER_REFERENCE = 100;
/*
 * Two years, not one. Ts-ics 2.4.3 drops the DTSTART occurrence of an observance RRULE whose
 * DTSTART carries a time of day, so the first year of the rules supplies no expanded onsets.
 * Starting the rules two years back leaves a whole expanded year before the earliest written
 * instant. Without it ts-ics finds no observance between January and the first onset of the
 * reference year, and generateIcsCalendar throws.
 */
const PROJECTION_YEARS_BEFORE_REFERENCE = 2;
const DAYS_OF_WEEK = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const vtimezoneCache = new Map<string, IcsTimezone>();

const buildBaselineObservance = (
  firstWallTime: Date,
  offsetMinutes: number,
): IcsTimezoneProp => {
  const offset = formatIcsUtcOffset(offsetMinutes);
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
    offsetFrom: formatIcsUtcOffset(transition.offsetFromMinutes),
    offsetTo: formatIcsUtcOffset(transition.offsetToMinutes),
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

const buildZoneVtimezone = (resolved: string, referenceInstant: Date): IcsTimezone => {
  if (Number.isNaN(referenceInstant.getTime())) {
    throw new RangeError(`A VTIMEZONE for ${resolved} needs a valid reference instant`);
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
  const recurringObservances: IcsTimezoneProp[] = [];
  for (const [first] of recurringTransitions ?? []) {
    if (first) {
      recurringObservances.push(buildRecurringObservance(first));
    }
  }
  /*
   * A zone with stable annual rules is written as exactly one STANDARD and one DAYLIGHT
   * observance, each with a yearly RRULE. Both first onsets fall in firstYear, well before
   * the earliest instant written in the zone, so every written time is covered.
   *
   * A no-op baseline STANDARD (offset to the same offset, no RRULE) in front of the rules
   * makes Outlook and Microsoft 365 subscribed calendars show standard-time events one hour
   * late. It is kept only where it carries information: fixed-offset zones, where it is the
   * sole observance, and zones without stable rules, where it anchors the explicit transitions.
   */
  let props: IcsTimezoneProp[] = recurringObservances;
  if (recurringObservances.length === 0) {
    props = [
      buildBaselineObservance(firstWallTime, initialOffset),
      ...transitions.map((transition) => buildTransitionObservance(transition)),
    ];
  }
  const builtTimezone: IcsTimezone = { id: resolved, props };
  vtimezoneCache.set(cacheKey, builtTimezone);
  return builtTimezone;
};

const buildVtimezone = (timezone: string | undefined, referenceInstant: Date): IcsTimezone | undefined => {
  const resolved = normalizeTimezone(timezone);
  if (!resolved || !isSupportedTimeZone(resolved) || Number.isNaN(referenceInstant.getTime())) {
    return;
  }
  return buildZoneVtimezone(resolved, referenceInstant);
};

export { buildVtimezone, buildZoneVtimezone };
