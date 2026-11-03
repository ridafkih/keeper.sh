import ICAL from "ical.js";

const MAX_OBSERVANCE_ONSETS = 50_000;
const MONTHS_PER_YEAR = 12;
const WEEKDAY_OCCURRENCES_PER_MONTH = 5;
const WEEKDAY_OCCURRENCES_PER_YEAR = 53;
const YEARLY_RULE_PARTS = new Set(["BYMONTH", "BYMONTHDAY", "BYDAY", "BYSETPOS"]);

const countPart = (parts: Record<string, unknown[] | undefined>, name: string): number | undefined =>
  parts[name]?.length;

const boundOnsetsPerYear = (parts: Record<string, unknown[] | undefined>): number => {
  const months = countPart(parts, "BYMONTH");
  const monthDays = countPart(parts, "BYMONTHDAY");
  const weekdays = countPart(parts, "BYDAY");
  if (monthDays !== globalThis.undefined) {
    return (months ?? MONTHS_PER_YEAR) * monthDays;
  }
  if (weekdays !== globalThis.undefined) {
    if (months === globalThis.undefined) {
      return weekdays * WEEKDAY_OCCURRENCES_PER_YEAR;
    }
    return months * weekdays * WEEKDAY_OCCURRENCES_PER_MONTH;
  }
  return months ?? 1;
};

const readRuleEndYear = (rule: ICAL.Recur, untilYear: number): number => {
  if (rule.until) {
    return Math.min(rule.until.year, untilYear);
  }
  return untilYear;
};

const boundRuleOnsets = (rule: ICAL.Recur, onsetYear: number, untilYear: number): number => {
  if (rule.freq !== "YEARLY") {
    throw new RangeError(`Declared VTIMEZONE observance repeats ${rule.freq}, not YEARLY`);
  }
  const unsupportedPart = Object.keys(rule.parts).find((name) => !YEARLY_RULE_PARTS.has(name));
  if (unsupportedPart) {
    throw new RangeError(`Declared VTIMEZONE observance uses ${unsupportedPart}`);
  }
  const years = Math.max(readRuleEndYear(rule, untilYear) - onsetYear + 1, 0);
  const interval = Math.max(rule.interval, 1);
  const onsets = Math.ceil(years / interval) * boundOnsetsPerYear(rule.parts);
  if (rule.count) {
    return Math.min(onsets, rule.count);
  }
  return onsets;
};

const assertObservanceExpansionBounded = (observance: ICAL.Component, untilYear: number): void => {
  const rule = observance.getFirstPropertyValue("rrule");
  const onset = observance.getFirstPropertyValue("dtstart");
  if (!(rule instanceof ICAL.Recur) || !(onset instanceof ICAL.Time)) {
    return;
  }
  const onsets = boundRuleOnsets(rule, onset.year, untilYear);
  if (onsets > MAX_OBSERVANCE_ONSETS) {
    throw new RangeError(`Declared VTIMEZONE observance expands to more than ${MAX_OBSERVANCE_ONSETS} onsets`);
  }
};

export { assertObservanceExpansionBounded, MAX_OBSERVANCE_ONSETS };
