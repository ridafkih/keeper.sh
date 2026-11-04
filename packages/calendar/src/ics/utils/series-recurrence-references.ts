import {
  readDateTimeWallTime,
  readTimeZoneParameter,
  toFloatingIcsDateTime,
  toUtcIcsDateTime,
} from "./ics-property";
import type { IcsProperty } from "./ics-property";
import { resolveDeclaredTimeZone } from "./resolve-timezone-identifier";
import type { DeclaredTimeZoneOffsets } from "./resolve-timezone-identifier";
import { wallTimeToInstant } from "./timezone-instant";

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
  uid: string;
  zone: SeriesZone;
}

type DateExclusionSlot = { instant: Date } | { wallTime: Date };

interface DateExclusionSlots {
  instants: string[];
  wallTimes: string[];
}

interface ExclusionSlotBudget {
  claim: (seriesUid: string, slots: number) => boolean;
}

const MS_PER_SECOND = 1000;
const MS_PER_HOUR = 60 * 60 * MS_PER_SECOND;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const HOURS_OF_DAY = Array.from({ length: 24 }, (_unused, hour) => hour);
const HOUR_RANGE: NumberRange = { max: 23, min: 0 };
const MINUTE_RANGE: NumberRange = { max: 59, min: 0 };
const SECOND_RANGE: NumberRange = { max: 60, min: 0 };
const MAX_SLOTS_PER_EXCLUDED_DATE = 1440;
const MAX_ADDED_EXCLUSION_SLOTS_PER_SERIES = 10_000;
const MAX_ADDED_EXCLUSION_SLOTS_PER_CALENDAR = 50_000;
const TIME_OF_DAY_FREQUENCIES = new Set(["MINUTELY", "SECONDLY"]);
const DATE_PATTERN = /^\d{8}$/;
const DATE_UNTIL_PATTERN = /(^|;)UNTIL=(\d{8})(?=;|$)/i;

const isIcsDate = (entry: string): boolean => DATE_PATTERN.test(entry);

const createExclusionSlotBudget = (): ExclusionSlotBudget => {
  let calendarRemaining = MAX_ADDED_EXCLUSION_SLOTS_PER_CALENDAR;
  const seriesRemaining = new Map<string, number>();
  const claim = (seriesUid: string, slots: number): boolean => {
    const added = Math.max(slots - 1, 0);
    const remaining = seriesRemaining.get(seriesUid) ?? MAX_ADDED_EXCLUSION_SLOTS_PER_SERIES;
    if (added > remaining || added > calendarRemaining) {
      return false;
    }
    seriesRemaining.set(seriesUid, remaining - added);
    calendarRemaining -= added;
    return true;
  };
  return { claim };
};

const readDateWallTime = (date: string, dayOffset = 0): Date => new Date(Date.UTC(
  Number(date.slice(0, 4)),
  Number(date.slice(4, 6)) - 1,
  Number(date.slice(6, 8)) + dayOffset,
));

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
  const declared = readTimeZoneParameter(start.property);
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
  const uid = findProperty(properties, "UID")?.value ?? "";
  return { rule: readSeriesRule(rule.value), startWallTime, uid, zone };
};

const readSeriesMasterContexts = (
  blocks: readonly (readonly IcsProperty[])[],
  calendarTimeZone: string | undefined,
  declaredOffsets: DeclaredTimeZoneOffsets,
): Map<string, SeriesMasterContext> => {
  const contexts = new Map<string, SeriesMasterContext>();
  for (const properties of blocks) {
    const context = readSeriesMasterContext(properties, calendarTimeZone, declaredOffsets);
    if (context?.uid && !contexts.has(context.uid)) {
      contexts.set(context.uid, context);
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
    readTimeZoneParameter(recurrenceIdentifier.property) !== globalThis.undefined
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

interface ElapsedHourSpan {
  count: number;
  firstInstant: number;
  step: number;
}

interface ExcludedSlotPlan {
  count: number;
  list: () => DateExclusionSlot[];
}

const readElapsedHourSpan = (date: string, master: SeriesMasterContext): ElapsedHourSpan | undefined => {
  const dayStart = toZoneInstant(readDateWallTime(date), master.zone);
  const dayEnd = toZoneInstant(readDateWallTime(date, 1), master.zone);
  const seriesStart = toZoneInstant(master.startWallTime, master.zone);
  if (!dayStart || !dayEnd || !seriesStart) {
    return;
  }
  const step = master.rule.interval * MS_PER_HOUR;
  const firstIndex = Math.max(Math.ceil((dayStart.getTime() - seriesStart.getTime()) / step), 0);
  const endIndex = Math.ceil((dayEnd.getTime() - seriesStart.getTime()) / step);
  return {
    count: Math.max(endIndex - firstIndex, 0),
    firstInstant: seriesStart.getTime() + firstIndex * step,
    step,
  };
};

const listElapsedHourInstants = (span: ElapsedHourSpan): DateExclusionSlot[] =>
  Array.from({ length: span.count }, (_unused, index) => ({
    instant: new Date(span.firstInstant + index * span.step),
  }));

const listMasterTimeOfDaySlot = (date: string, master: SeriesMasterContext): DateExclusionSlot[] => [
  { wallTime: new Date(readDateWallTime(date).getTime() + timeOfDayMilliseconds(master.startWallTime)) },
];

const planMasterTimeOfDaySlot = (date: string, master: SeriesMasterContext): ExcludedSlotPlan => ({
  count: 1,
  list: () => listMasterTimeOfDaySlot(date, master),
});

const planSelectedSlotWallTimes = (date: string, master: SeriesMasterContext): ExcludedSlotPlan => {
  const dayStart = readDateWallTime(date).getTime();
  const { rule, startWallTime } = master;
  let defaultHours = [startWallTime.getUTCHours()];
  if (rule.frequency === "HOURLY") {
    defaultHours = HOURS_OF_DAY;
  }
  const hours = rule.byHour ?? defaultHours;
  const minutes = rule.byMinute ?? [startWallTime.getUTCMinutes()];
  const seconds = rule.bySecond ?? [startWallTime.getUTCSeconds()];
  const count = hours.length * minutes.length * seconds.length;
  if (count > MAX_SLOTS_PER_EXCLUDED_DATE) {
    throw new RangeError(`DATE EXDATE ${date} covers more than ${MAX_SLOTS_PER_EXCLUDED_DATE} series slots`);
  }
  return {
    count,
    list: () => hours.flatMap((hour) => minutes.flatMap((minute) => seconds.map((second) => ({
      wallTime: new Date(dayStart + Date.UTC(1970, 0, 1, hour, minute, second)),
    })))),
  };
};

const planExcludedSlots = (date: string, master: SeriesMasterContext): ExcludedSlotPlan => {
  if (TIME_OF_DAY_FREQUENCIES.has(master.rule.frequency)) {
    return planMasterTimeOfDaySlot(date, master);
  }
  const stepsInElapsedHours = master.rule.frequency === "HOURLY" && !master.rule.hasSelectors;
  const elapsedSpan = stepsInElapsedHours && readElapsedHourSpan(date, master);
  if (elapsedSpan) {
    return { count: elapsedSpan.count, list: () => listElapsedHourInstants(elapsedSpan) };
  }
  return planSelectedSlotWallTimes(date, master);
};

const listAffordableSlots = (
  date: string,
  master: SeriesMasterContext,
  budget: ExclusionSlotBudget,
): DateExclusionSlot[] => {
  const plan = planExcludedSlots(date, master);
  if (budget.claim(master.uid, plan.count)) {
    return plan.list();
  }
  return listMasterTimeOfDaySlot(date, master);
};

const isWallTimeSlot = (slot: DateExclusionSlot): slot is { wallTime: Date } => "wallTime" in slot;

const resolveSlotInstant = (slot: DateExclusionSlot, zone: SeriesZone): Date | undefined => {
  if ("instant" in slot) {
    return slot.instant;
  }
  return toZoneInstant(slot.wallTime, zone);
};

const expandDateExclusion = (
  date: string,
  master: SeriesMasterContext,
  budget: ExclusionSlotBudget,
): DateExclusionSlots => {
  const slots = listAffordableSlots(date, master, budget);
  const instants = slots.map((slot) => resolveSlotInstant(slot, master.zone));
  if (instants.every((instant) => instant !== globalThis.undefined)) {
    return { instants: instants.map((instant) => toUtcIcsDateTime(instant)), wallTimes: [] };
  }
  return {
    instants: [],
    wallTimes: slots.filter((slot) => isWallTimeSlot(slot)).map((slot) => toFloatingIcsDateTime(slot.wallTime)),
  };
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
  anchorRecurrenceIdentifier,
  createExclusionSlotBudget,
  expandDateExclusion,
  isDateExclusionEntry,
  readSeriesMasterContext,
  readSeriesMasterContexts,
  toEndOfLocalDayUntil,
  withoutValueParameter,
};
export type { DateExclusionSlots, ExclusionSlotBudget, SeriesMasterContext };
