import { resolveDeclaredTimeZone } from "./resolve-timezone-identifier";
import type { DeclaredTimeZoneOffsets } from "./resolve-timezone-identifier";
import { wallTimeToInstant } from "./timezone-instant";

interface IcsProperty {
  parameters: string[];
  property: string;
  propertyName: string;
  value: string;
}

type SeriesZone =
  | { kind: "utc" }
  | { kind: "zoned"; declared: string; resolved?: string };

interface SeriesRule {
  byHour?: number[];
  byMinute?: number[];
  bySecond?: number[];
  frequency: string;
  hasSelectors: boolean;
  interval: number;
}

interface SeriesMasterContext {
  rule: SeriesRule;
  startWallTime: Date;
  zone: SeriesZone;
}

interface DateExclusionSlots {
  instants: string[];
  wallTimes: string[];
}

const MS_PER_SECOND = 1000;
const MS_PER_HOUR = 60 * 60 * MS_PER_SECOND;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const HOURS_OF_DAY = Array.from({ length: 24 }, (_unused, hour) => hour);
const HOUR_RANGE: NumberRange = { max: 23, min: 0 };
const MINUTE_RANGE: NumberRange = { max: 59, min: 0 };
const SECOND_RANGE: NumberRange = { max: 60, min: 0 };
const MAX_SLOTS_PER_EXCLUDED_DATE = 1440;
const MAX_EXCLUDED_SLOTS_PER_PROPERTY = 100_000;
const TIME_OF_DAY_FREQUENCIES = new Set(["MINUTELY", "SECONDLY"]);
const DATE_PATTERN = /^\d{8}$/;
const DATE_TIME_PATTERN = /^(\d{8})T(\d{6})$/;
const DATE_UNTIL_PATTERN = /(^|;)UNTIL=(\d{8})(?=;|$)/i;
const TZID_PARAMETER_PATTERN = /;TZID=(?:"([^"]*)"|([^;:]*))/i;

const isIcsDate = (entry: string): boolean => DATE_PATTERN.test(entry);

const padded = (value: number, length = 2): string => String(value).padStart(length, "0");

const toFloatingIcsDateTime = (wallTime: Date): string => [
  padded(wallTime.getUTCFullYear(), 4),
  padded(wallTime.getUTCMonth() + 1),
  padded(wallTime.getUTCDate()),
  "T",
  padded(wallTime.getUTCHours()),
  padded(wallTime.getUTCMinutes()),
  padded(wallTime.getUTCSeconds()),
].join("");

const toUtcIcsDateTime = (instant: Date): string => `${toFloatingIcsDateTime(instant)}Z`;

const readDateWallTime = (date: string, dayOffset = 0): Date => new Date(Date.UTC(
  Number(date.slice(0, 4)),
  Number(date.slice(4, 6)) - 1,
  Number(date.slice(6, 8)) + dayOffset,
));

const readDateTimeWallTime = (value: string): Date | undefined => {
  const [, date, time] = DATE_TIME_PATTERN.exec(value.replace(/Z$/i, "")) ?? [];
  if (!date || !time) {
    return;
  }
  return new Date(Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(4, 6)) - 1,
    Number(date.slice(6, 8)),
    Number(time.slice(0, 2)),
    Number(time.slice(2, 4)),
    Number(time.slice(4, 6)),
  ));
};

interface NumberRange {
  max: number;
  min: number;
}

const readNumberList = (value: string | undefined, range: NumberRange): number[] | undefined => {
  if (!value) {
    return;
  }
  const numbers = new Set(value.split(",").map(Number));
  return [...numbers]
    .filter((number) => Number.isInteger(number) && number >= range.min && number <= range.max)
    .toSorted((left, right) => left - right);
};

const readSeriesRule = (ruleValue: string): SeriesRule => {
  const parts = new Map(ruleValue.split(";").map((part) => {
    const [name = "", value = ""] = part.split("=");
    return [name.toUpperCase(), value];
  }));
  const byHour = readNumberList(parts.get("BYHOUR"), HOUR_RANGE);
  const byMinute = readNumberList(parts.get("BYMINUTE"), MINUTE_RANGE);
  const bySecond = readNumberList(parts.get("BYSECOND"), SECOND_RANGE);
  return {
    ...byHour && { byHour },
    ...byMinute && { byMinute },
    ...bySecond && { bySecond },
    frequency: (parts.get("FREQ") ?? "").toUpperCase(),
    hasSelectors: [...parts.keys()].some((name) => name.startsWith("BY")),
    interval: Math.max(Number(parts.get("INTERVAL") ?? 1), 1),
  };
};

const readSeriesZone = (
  start: IcsProperty,
  calendarTimeZone: string | undefined,
  declaredOffsets: DeclaredTimeZoneOffsets,
): SeriesZone | undefined => {
  const match = TZID_PARAMETER_PATTERN.exec(start.property);
  const declared = match?.[1] ?? match?.[2];
  if (declared) {
    return { declared, kind: "zoned", resolved: resolveDeclaredTimeZone(declared, declaredOffsets) };
  }
  if (/Z$/i.test(start.value)) {
    return { kind: "utc" };
  }
  if (!calendarTimeZone) {
    return;
  }
  return {
    declared: calendarTimeZone,
    kind: "zoned",
    resolved: resolveDeclaredTimeZone(calendarTimeZone, declaredOffsets),
  };
};

const findProperty = (
  properties: readonly IcsProperty[],
  propertyName: string,
): IcsProperty | undefined => properties.find((property) => property.propertyName === propertyName);

const readSeriesMasterContext = (
  properties: readonly IcsProperty[],
  calendarTimeZone: string | undefined,
  declaredOffsets: DeclaredTimeZoneOffsets,
): SeriesMasterContext | undefined => {
  const start = findProperty(properties, "DTSTART");
  const rule = findProperty(properties, "RRULE");
  if (!start || !rule || findProperty(properties, "RECURRENCE-ID")) {
    return;
  }
  const startWallTime = readDateTimeWallTime(start.value);
  const zone = readSeriesZone(start, calendarTimeZone, declaredOffsets);
  if (!startWallTime || !zone || start.parameters.includes("VALUE=DATE")) {
    return;
  }
  return { rule: readSeriesRule(rule.value), startWallTime, zone };
};

const readSeriesMasterContexts = (
  blocks: readonly (readonly IcsProperty[])[],
  calendarTimeZone: string | undefined,
  declaredOffsets: DeclaredTimeZoneOffsets,
): Map<string, SeriesMasterContext> => {
  const contexts = new Map<string, SeriesMasterContext>();
  for (const properties of blocks) {
    const uid = findProperty(properties, "UID")?.value;
    const context = readSeriesMasterContext(properties, calendarTimeZone, declaredOffsets);
    if (uid && context && !contexts.has(uid)) {
      contexts.set(uid, context);
    }
  }
  return contexts;
};

const toZoneInstant = (wallTime: Date, zone: SeriesZone): Date | undefined => {
  if (zone.kind === "utc") {
    return wallTime;
  }
  if (!zone.resolved) {
    return;
  }
  return wallTimeToInstant(wallTime, zone.resolved);
};

const withoutValueParameter = (property: string): string => property
  .split(";")
  .filter((part) => !/^VALUE=/i.test(part))
  .join(";");

const timeOfDayMilliseconds = (wallTime: Date): number =>
  ((wallTime.getTime() % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY;

const anchorRecurrenceIdentifier = (
  recurrenceIdentifier: IcsProperty,
  master: SeriesMasterContext,
): string | undefined => {
  if (
    TZID_PARAMETER_PATTERN.test(recurrenceIdentifier.property)
    || /Z$/i.test(recurrenceIdentifier.value)
  ) {
    return;
  }
  let wallTime = readDateTimeWallTime(recurrenceIdentifier.value);
  if (isIcsDate(recurrenceIdentifier.value)) {
    wallTime = new Date(
      readDateWallTime(recurrenceIdentifier.value).getTime()
      + timeOfDayMilliseconds(master.startWallTime),
    );
  }
  if (!wallTime) {
    return;
  }
  const property = withoutValueParameter(recurrenceIdentifier.property);
  if (master.zone.kind === "utc") {
    return `${property}:${toUtcIcsDateTime(wallTime)}`;
  }
  return `${property};TZID=${master.zone.declared}:${toFloatingIcsDateTime(wallTime)}`;
};

const listElapsedHourInstants = (date: string, master: SeriesMasterContext): Date[] | undefined => {
  const dayStart = toZoneInstant(readDateWallTime(date), master.zone);
  const dayEnd = toZoneInstant(readDateWallTime(date, 1), master.zone);
  const seriesStart = toZoneInstant(master.startWallTime, master.zone);
  if (!dayStart || !dayEnd || !seriesStart) {
    return;
  }
  const step = master.rule.interval * MS_PER_HOUR;
  const firstIndex = Math.max(Math.ceil((dayStart.getTime() - seriesStart.getTime()) / step), 0);
  const instants: Date[] = [];
  for (let index = firstIndex; seriesStart.getTime() + index * step < dayEnd.getTime(); index++) {
    instants.push(new Date(seriesStart.getTime() + index * step));
  }
  return instants;
};

const listSlotWallTimes = (date: string, master: SeriesMasterContext): Date[] => {
  const dayStart = readDateWallTime(date).getTime();
  const { rule, startWallTime } = master;
  if (TIME_OF_DAY_FREQUENCIES.has(rule.frequency)) {
    return [new Date(dayStart + timeOfDayMilliseconds(startWallTime))];
  }
  let defaultHours = [startWallTime.getUTCHours()];
  if (rule.frequency === "HOURLY") {
    defaultHours = HOURS_OF_DAY;
  }
  const hours = rule.byHour ?? defaultHours;
  const minutes = rule.byMinute ?? [startWallTime.getUTCMinutes()];
  const seconds = rule.bySecond ?? [startWallTime.getUTCSeconds()];
  if (hours.length * minutes.length * seconds.length > MAX_SLOTS_PER_EXCLUDED_DATE) {
    throw new RangeError(`DATE EXDATE ${date} covers more than ${MAX_SLOTS_PER_EXCLUDED_DATE} series slots`);
  }
  return hours.flatMap((hour) => minutes.flatMap((minute) => seconds.map((second) =>
    new Date(dayStart + Date.UTC(1970, 0, 1, hour, minute, second)))));
};

const expandDateExclusion = (date: string, master: SeriesMasterContext): DateExclusionSlots => {
  const stepsInElapsedHours = master.rule.frequency === "HOURLY" && !master.rule.hasSelectors;
  const elapsedInstants = stepsInElapsedHours && listElapsedHourInstants(date, master);
  if (elapsedInstants) {
    return { instants: elapsedInstants.map((instant) => toUtcIcsDateTime(instant)), wallTimes: [] };
  }
  const wallTimes = listSlotWallTimes(date, master);
  if (master.zone.kind === "utc") {
    return { instants: wallTimes.map((wallTime) => toUtcIcsDateTime(wallTime)), wallTimes: [] };
  }
  return { instants: [], wallTimes: wallTimes.map((wallTime) => toFloatingIcsDateTime(wallTime)) };
};

const isDateExclusionEntry = (exclusion: IcsProperty, entry: string): boolean =>
  exclusion.parameters.includes("VALUE=DATE") || isIcsDate(entry);

const toEndOfLocalDayUntil = (ruleValue: string, master: SeriesMasterContext): string => {
  const date = DATE_UNTIL_PATTERN.exec(ruleValue)?.[2];
  if (!date) {
    return ruleValue;
  }
  const nextLocalMidnight = toZoneInstant(readDateWallTime(date, 1), master.zone);
  if (!nextLocalMidnight) {
    return ruleValue;
  }
  const until = toUtcIcsDateTime(new Date(nextLocalMidnight.getTime() - MS_PER_SECOND));
  return ruleValue.replace(DATE_UNTIL_PATTERN, (_matched, prefix: string) => `${prefix}UNTIL=${until}`);
};

export {
  MAX_EXCLUDED_SLOTS_PER_PROPERTY,
  anchorRecurrenceIdentifier,
  expandDateExclusion,
  isDateExclusionEntry,
  readSeriesMasterContext,
  readSeriesMasterContexts,
  toEndOfLocalDayUntil,
  withoutValueParameter,
};
export type { DateExclusionSlots, IcsProperty, SeriesMasterContext };
