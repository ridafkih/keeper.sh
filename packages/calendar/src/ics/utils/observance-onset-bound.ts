import ICAL from "ical.js";

interface OnsetBudget {
  expand: <TChange>(
    observances: readonly ICAL.Component[],
    untilYear: number,
    expandObservances: () => TChange[],
  ) => TChange[];
}

type RuleParts = Record<string, unknown[] | undefined>;

const MAX_ZONE_ONSETS = 50_000;
const MAX_CALENDAR_ONSETS = 200_000;
const MONTHS_PER_YEAR = 12;
const WEEKS_PER_YEAR = 53;
const DAYS_PER_YEAR = 366;
const DAYS_PER_MONTH = 31;
const WEEKDAY_OCCURRENCES_PER_MONTH = 5;
const DAYS_PER_WEEK = 7;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;

const FREQUENCY_RANKS: Record<string, number> = {
  DAILY: 3,
  HOURLY: 4,
  MINUTELY: 5,
  MONTHLY: 1,
  SECONDLY: 6,
  WEEKLY: 2,
  YEARLY: 0,
};
const FINEST_FREQUENCY_RANK = 6;
const HOURLY_RANK = 4;
const MINUTELY_RANK = 5;
const SECONDLY_RANK = 6;

const UNITS_PER_DAY_BY_FREQUENCY: Record<string, number> = {
  HOURLY: HOURS_PER_DAY,
  MINUTELY: HOURS_PER_DAY * MINUTES_PER_HOUR,
  SECONDLY: HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE,
};

const countPart = (parts: RuleParts, name: string): number | undefined => parts[name]?.length;

const readFrequencyRank = (rule: ICAL.Recur): number =>
  FREQUENCY_RANKS[rule.freq] ?? FINEST_FREQUENCY_RANK;

const readInterval = (rule: ICAL.Recur): number => Math.max(rule.interval, 1);

const boundUnfilteredDaysPerYear = (rule: ICAL.Recur, months: number | undefined): number => {
  const interval = readInterval(rule);
  switch (rule.freq) {
    case "YEARLY": {
      return months ?? 1;
    }
    case "MONTHLY": {
      return months ?? Math.ceil(MONTHS_PER_YEAR / interval);
    }
    case "WEEKLY": {
      if (months !== globalThis.undefined) {
        return months * WEEKDAY_OCCURRENCES_PER_MONTH;
      }
      return Math.ceil(WEEKS_PER_YEAR / interval);
    }
    case "DAILY": {
      if (months !== globalThis.undefined) {
        return months * DAYS_PER_MONTH;
      }
      return Math.ceil(DAYS_PER_YEAR / interval);
    }
    default: {
      if (months !== globalThis.undefined) {
        return months * DAYS_PER_MONTH;
      }
      return DAYS_PER_YEAR;
    }
  }
};

const boundOnsetDaysPerYear = (rule: ICAL.Recur): number => {
  const { parts } = rule;
  const yearDays = countPart(parts, "BYYEARDAY");
  if (yearDays !== globalThis.undefined) {
    return yearDays;
  }
  const weeks = countPart(parts, "BYWEEKNO");
  if (weeks !== globalThis.undefined) {
    return weeks * (countPart(parts, "BYDAY") ?? DAYS_PER_WEEK);
  }
  const months = countPart(parts, "BYMONTH");
  const monthDays = countPart(parts, "BYMONTHDAY");
  const weekdays = countPart(parts, "BYDAY");
  if (monthDays !== globalThis.undefined) {
    return (months ?? MONTHS_PER_YEAR) * monthDays;
  }
  if (weekdays !== globalThis.undefined) {
    if (months === globalThis.undefined) {
      return weekdays * WEEKS_PER_YEAR;
    }
    return months * weekdays * WEEKDAY_OCCURRENCES_PER_MONTH;
  }
  return boundUnfilteredDaysPerYear(rule, months);
};

const countTimeOfDayPart = (
  parts: RuleParts,
  name: string,
  frequencyRank: number,
  expandingRank: number,
  unitsPerParent: number,
): number => {
  const selected = countPart(parts, name);
  if (selected !== globalThis.undefined) {
    return selected;
  }
  if (frequencyRank >= expandingRank) {
    return unitsPerParent;
  }
  return 1;
};

const boundOnsetsPerDay = (rule: ICAL.Recur): number => {
  const rank = readFrequencyRank(rule);
  const selected = countTimeOfDayPart(rule.parts, "BYHOUR", rank, HOURLY_RANK, HOURS_PER_DAY)
    * countTimeOfDayPart(rule.parts, "BYMINUTE", rank, MINUTELY_RANK, MINUTES_PER_HOUR)
    * countTimeOfDayPart(rule.parts, "BYSECOND", rank, SECONDLY_RANK, SECONDS_PER_MINUTE);
  const unitsPerDay = UNITS_PER_DAY_BY_FREQUENCY[rule.freq];
  if (unitsPerDay === globalThis.undefined) {
    return selected;
  }
  return Math.min(selected, Math.ceil(unitsPerDay / readInterval(rule)));
};

const readRuleEndYear = (rule: ICAL.Recur, untilYear: number): number => {
  if (rule.until) {
    return Math.min(rule.until.year, untilYear);
  }
  return untilYear;
};

const countRuleYears = (rule: ICAL.Recur, onsetYear: number, untilYear: number): number => {
  const years = Math.max(readRuleEndYear(rule, untilYear) - onsetYear + 1, 0);
  if (rule.freq === "YEARLY") {
    return Math.ceil(years / readInterval(rule));
  }
  return years;
};

const boundRuleOnsets = (rule: ICAL.Recur, onsetYear: number, untilYear: number): number => {
  const onsets = countRuleYears(rule, onsetYear, untilYear) * boundOnsetDaysPerYear(rule) * boundOnsetsPerDay(rule);
  if (rule.count) {
    return Math.min(onsets, rule.count);
  }
  return onsets;
};

const boundObservanceOnsets = (observance: ICAL.Component, untilYear: number): number => {
  const rule = observance.getFirstPropertyValue("rrule");
  const onset = observance.getFirstPropertyValue("dtstart");
  if (!(rule instanceof ICAL.Recur) || !(onset instanceof ICAL.Time)) {
    return 0;
  }
  return boundRuleOnsets(rule, onset.year, untilYear);
};

const boundZoneOnsets = (observances: readonly ICAL.Component[], untilYear: number): number =>
  observances.reduce((total, observance) => total + boundObservanceOnsets(observance, untilYear), 0);

const createOnsetBudget = (): OnsetBudget => {
  let remaining = MAX_CALENDAR_ONSETS;
  const expand = <TChange>(
    observances: readonly ICAL.Component[],
    untilYear: number,
    expandObservances: () => TChange[],
  ): TChange[] => {
    if (boundZoneOnsets(observances, untilYear) > MAX_ZONE_ONSETS) {
      throw new RangeError(`Declared VTIMEZONE expands to more than ${MAX_ZONE_ONSETS} onsets`);
    }
    if (remaining <= 0) {
      throw new RangeError(`Declared VTIMEZONEs expand to more than ${MAX_CALENDAR_ONSETS} onsets in one calendar`);
    }
    const changes = expandObservances();
    remaining -= changes.length;
    return changes;
  };
  return { expand };
};

export { createOnsetBudget };
export type { OnsetBudget };
