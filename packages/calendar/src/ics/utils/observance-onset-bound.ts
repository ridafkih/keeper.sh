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
const WEEKDAY_OCCURRENCES_PER_MONTH = 5;
const DAYS_PER_WEEK = 7;
const SELF_TERMINATING_FREQUENCIES = new Set(["MONTHLY", "YEARLY"]);
const WEEKLY_FILTER_PARTS = ["BYMONTH", "BYMONTHDAY", "BYWEEKNO", "BYYEARDAY"];

const countPart = (parts: RuleParts, name: string): number | undefined => parts[name]?.length;

const readInterval = (rule: ICAL.Recur): number => Math.max(rule.interval, 1);

const isUnfilteredWeeklyRule = (rule: ICAL.Recur): boolean =>
  rule.freq === "WEEKLY" && WEEKLY_FILTER_PARTS.every((name) => countPart(rule.parts, name) === globalThis.undefined);

const isExpandableRule = (rule: ICAL.Recur): boolean =>
  SELF_TERMINATING_FREQUENCIES.has(rule.freq) || isUnfilteredWeeklyRule(rule);

const boundUnfilteredDaysPerYear = (rule: ICAL.Recur, months: number | undefined): number => {
  const interval = readInterval(rule);
  switch (rule.freq) {
    case "MONTHLY": {
      return months ?? Math.ceil(MONTHS_PER_YEAR / interval);
    }
    case "WEEKLY": {
      return Math.ceil(WEEKS_PER_YEAR / interval);
    }
    default: {
      return months ?? 1;
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

const boundOnsetsPerDay = (rule: ICAL.Recur): number =>
  (countPart(rule.parts, "BYHOUR") ?? 1)
  * (countPart(rule.parts, "BYMINUTE") ?? 1)
  * (countPart(rule.parts, "BYSECOND") ?? 1);

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
  if (!isExpandableRule(rule)) {
    throw new RangeError(`Declared VTIMEZONE observance repeats ${rule.freq}, which ical.js may step through forever`);
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
