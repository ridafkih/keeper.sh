import type { IcsRecurrenceRule } from "ts-ics";
import type { OutlookEvent } from "@keeper.sh/data-schemas";
import type { SyncableEvent } from "../../../core/types";

type OutlookRecurrence = NonNullable<OutlookEvent["recurrence"]>;
type OutlookRecurrencePattern = OutlookRecurrence["pattern"];
type OutlookRecurrenceRange = OutlookRecurrence["range"];

const ICS_DAY_TO_OUTLOOK_DAY: Record<string, string> = {
  FR: "friday",
  MO: "monday",
  SA: "saturday",
  SU: "sunday",
  TH: "thursday",
  TU: "tuesday",
  WE: "wednesday",
};

const OCCURRENCE_TO_INDEX: Record<number, string> = {
  [-1]: "last",
  1: "first",
  2: "second",
  3: "third",
  4: "fourth",
};

const formatOutlookDate = (value: Date): string => value.toISOString().slice(0, 10);

const buildRange = (rule: IcsRecurrenceRule, startTime: Date): OutlookRecurrenceRange => {
  const startDate = formatOutlookDate(startTime);

  if (rule.until) {
    return { endDate: formatOutlookDate(rule.until.date), startDate, type: "endDate" };
  }

  if (typeof rule.count === "number") {
    return { numberOfOccurrences: rule.count, startDate, type: "numbered" };
  }

  return { startDate, type: "noEnd" };
};

const WEEK_DAYS_BY_INDEX = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

const buildWeeklyPattern = (rule: IcsRecurrenceRule, startTime: Date): OutlookRecurrencePattern | null => {
  const days = rule.byDay?.map((entry) => ICS_DAY_TO_OUTLOOK_DAY[entry.day]).filter((day): day is string => typeof day === "string");
  const fallbackIcsDay = WEEK_DAYS_BY_INDEX[startTime.getUTCDay()] ?? "MO";
  const fallbackDay = ICS_DAY_TO_OUTLOOK_DAY[fallbackIcsDay] ?? "monday";

  let daysOfWeek = [fallbackDay];
  if (days && days.length > 0) {
    daysOfWeek = days;
  }

  return { daysOfWeek, interval: rule.interval ?? 1, type: "weekly" };
};

const buildMonthlyPattern = (rule: IcsRecurrenceRule, startTime: Date): OutlookRecurrencePattern | null => {
  const byDayEntry = rule.byDay?.[0];

  if (byDayEntry && typeof byDayEntry.occurrence === "number") {
    const index = OCCURRENCE_TO_INDEX[byDayEntry.occurrence];
    const day = ICS_DAY_TO_OUTLOOK_DAY[byDayEntry.day];
    if (!index || !day) {
      return null;
    }
    return { daysOfWeek: [day], index, interval: rule.interval ?? 1, type: "relativeMonthly" };
  }

  const dayOfMonth = rule.byMonthday?.[0] ?? startTime.getUTCDate();
  return { dayOfMonth, interval: rule.interval ?? 1, type: "absoluteMonthly" };
};

const buildYearlyPattern = (rule: IcsRecurrenceRule, startTime: Date): OutlookRecurrencePattern | null => {
  const byDayEntry = rule.byDay?.[0];
  const month = rule.byMonth?.[0] ?? startTime.getUTCMonth() + 1;

  if (byDayEntry && typeof byDayEntry.occurrence === "number") {
    const index = OCCURRENCE_TO_INDEX[byDayEntry.occurrence];
    const day = ICS_DAY_TO_OUTLOOK_DAY[byDayEntry.day];
    if (!index || !day) {
      return null;
    }
    return { daysOfWeek: [day], index, interval: rule.interval ?? 1, month, type: "relativeYearly" };
  }

  const dayOfMonth = rule.byMonthday?.[0] ?? startTime.getUTCDate();
  return { dayOfMonth, interval: rule.interval ?? 1, month, type: "absoluteYearly" };
};

const buildPattern = (rule: IcsRecurrenceRule, startTime: Date): OutlookRecurrencePattern | null => {
  switch (rule.frequency) {
    case "DAILY": {
      return { interval: rule.interval ?? 1, type: "daily" };
    }
    case "WEEKLY": {
      return buildWeeklyPattern(rule, startTime);
    }
    case "MONTHLY": {
      return buildMonthlyPattern(rule, startTime);
    }
    case "YEARLY": {
      return buildYearlyPattern(rule, startTime);
    }
    default: {
      return null;
    }
  }
};

/**
 * Microsoft Graph has no equivalent to sub-daily RRULE frequencies (SECONDLY/MINUTELY/HOURLY),
 * so those series are pushed as a single non-recurring event rather than dropped or crashing.
 */
const buildOutlookRecurrence = (event: SyncableEvent): OutlookRecurrence | undefined => {
  if (!event.recurrenceRule) {
    return;
  }

  const rule = event.recurrenceRule;

  const pattern = buildPattern(rule, event.startTime);
  if (!pattern) {
    return;
  }

  return { pattern, range: buildRange(rule, event.startTime) };
};

export { buildOutlookRecurrence };
