import type { SyncableEvent } from "../../../core/types";

const formatByDayValue = (value: { day: string; occurrence?: number }): string => {
  if (value.occurrence) {
    return `${value.occurrence}${value.day}`;
  }
  return value.day;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const formatRecurrenceDate = (value: Date | string): string => {
  if (value instanceof Date) {
    return value.toISOString().replaceAll(/[-:]/g, "").replace(/\.\d{3}/, "");
  }
  return new Date(value).toISOString().replaceAll(/[-:]/g, "").replace(/\.\d{3}/, "");
};

const parseNumberArray = (value: unknown): number[] | undefined => {
  if (!Array.isArray(value)) {
    return;
  }
  if (value.some((entry) => typeof entry !== "number")) {
    return;
  }
  return value;
};

const parseByDay = (value: unknown): { day: string; occurrence?: number }[] | undefined => {
  if (!Array.isArray(value)) {
    return;
  }

  const parsed: { day: string; occurrence?: number }[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.day !== "string") {
      continue;
    }
    if ("occurrence" in entry && typeof entry.occurrence !== "number") {
      continue;
    }
    if (typeof entry.occurrence === "number") {
      parsed.push({ day: entry.day, occurrence: entry.occurrence });
    } else {
      parsed.push({ day: entry.day });
    }
  }

  if (parsed.length === 0) {
    return;
  }
  return parsed;
};

const pushNumberArrayPart = (parts: string[], key: string, value: unknown): void => {
  const numbers = parseNumberArray(value);
  if (numbers?.length) {
    parts.push(`${key}=${numbers.join(",")}`);
  }
};

const buildRecurrenceRule = (event: SyncableEvent): string | null => {
  const { recurrenceRule } = event;
  if (!isRecord(recurrenceRule)) {
    return null;
  }
  if (typeof recurrenceRule.frequency !== "string") {
    return null;
  }

  const parts: string[] = [`FREQ=${recurrenceRule.frequency}`];

  if (typeof recurrenceRule.interval === "number") {
    parts.push(`INTERVAL=${recurrenceRule.interval}`);
  }
  if (typeof recurrenceRule.count === "number") {
    parts.push(`COUNT=${recurrenceRule.count}`);
  }
  if (isRecord(recurrenceRule.until)) {
    const untilDate = recurrenceRule.until.date;
    if (untilDate instanceof Date || typeof untilDate === "string") {
      parts.push(`UNTIL=${formatRecurrenceDate(untilDate)}`);
    }
  }

  const byDay = parseByDay(recurrenceRule.byDay);
  if (byDay?.length) {
    parts.push(`BYDAY=${byDay.map((value) => formatByDayValue(value)).join(",")}`);
  }

  pushNumberArrayPart(parts, "BYMONTH", recurrenceRule.byMonth);
  pushNumberArrayPart(parts, "BYMONTHDAY", recurrenceRule.byMonthday);
  pushNumberArrayPart(parts, "BYSETPOS", recurrenceRule.bySetPos);
  pushNumberArrayPart(parts, "BYYEARDAY", recurrenceRule.byYearday);
  pushNumberArrayPart(parts, "BYWEEKNO", recurrenceRule.byWeekNo);
  pushNumberArrayPart(parts, "BYHOUR", recurrenceRule.byHour);
  pushNumberArrayPart(parts, "BYMINUTE", recurrenceRule.byMinute);
  pushNumberArrayPart(parts, "BYSECOND", recurrenceRule.bySecond);

  if (typeof recurrenceRule.workweekStart === "string") {
    parts.push(`WKST=${recurrenceRule.workweekStart}`);
  }

  return parts.join(";");
};

export { buildRecurrenceRule };
