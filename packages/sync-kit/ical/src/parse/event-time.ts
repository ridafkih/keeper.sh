import type { CalendarDate, EventTime, Instant, WithholdReason, ZoneId } from "@keeper.sh/sync-protocol";
import type { IcsOptions } from "../options";
import { parameterValue } from "../text/property-line";
import type { PropertyLine } from "../text/property-line";
import { millisecondsInMinute } from "../zone/offset";
import { instantOf, instantToWallTime } from "../zone/wall-time";
import type { ZoneCache } from "../zone/zone-cache";
import { calendarDateOf, resolveDateValue } from "./date-value";
import type { DateValue } from "./date-value";
import { parseIcsDuration } from "./duration";
import type { IcsDocument, VeventComponent } from "./parse-calendar";

type TimeResolution =
  | { readonly kind: "resolved"; readonly time: EventTime }
  | { readonly kind: "withheld"; readonly reason: WithholdReason };

type EventTimeResolution =
  | { readonly kind: "resolved"; readonly time: EventTime; readonly fullDayZone: ZoneId | null }
  | { readonly kind: "withheld"; readonly reason: WithholdReason };

const millisecondsInSecond = 1000;
const millisecondsInDay = 24 * 60 * millisecondsInMinute;

const propertyNamed = (component: VeventComponent, name: string): PropertyLine | undefined =>
  component.properties.findLast((property) => property.name === name);

const eventZoneOf = (component: VeventComponent): string | null => {
  const start = propertyNamed(component, "DTSTART");
  if (!start) {
    return null;
  }
  return parameterValue(start.params, "TZID");
};

const shiftedDate = (date: CalendarDate, days: number): CalendarDate => {
  const shifted = new Date(`${date.value}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return calendarDateOf(shifted.toISOString().slice(0, 10).replaceAll("-", ""));
};

const durationOf = (component: VeventComponent): { readonly text: string } | null => {
  const declared = propertyNamed(component, "DURATION");
  if (!declared) {
    return null;
  }
  return { text: declared.value.trim() };
};

const allDayEnd = (component: VeventComponent, start: CalendarDate, end: DateValue | null): TimeResolution => {
  if (end && end.kind === "date") {
    if (end.date.value < start.value) {
      return { kind: "withheld", reason: "unrepresentableTime" };
    }
    return { kind: "resolved", time: { kind: "allDay", startDate: start, endDateExclusive: end.date } };
  }
  if (end && end.kind === "unresolved") {
    return { kind: "withheld", reason: end.reason };
  }
  const duration = durationOf(component);
  if (!duration) {
    return {
      kind: "resolved",
      time: { kind: "allDay", startDate: start, endDateExclusive: shiftedDate(start, 1) },
    };
  }
  const parsed = parseIcsDuration(duration.text);
  if (!parsed || parsed.kind !== "nominal") {
    return { kind: "withheld", reason: "unrepresentableTime" };
  }
  return {
    kind: "resolved",
    time: { kind: "allDay", startDate: start, endDateExclusive: shiftedDate(start, parsed.days) },
  };
};

const timedEnd = (
  component: VeventComponent,
  start: Instant,
  zone: ZoneId | null,
  end: DateValue | null,
): TimeResolution => {
  const startMs = Date.parse(start.value);
  if (end && end.kind === "instant") {
    if (Date.parse(end.instant.value) < startMs) {
      return { kind: "withheld", reason: "unrepresentableTime" };
    }
    return { kind: "resolved", time: { kind: "timed", start, end: end.instant, zone } };
  }
  if (end && end.kind === "unresolved") {
    return { kind: "withheld", reason: end.reason };
  }
  if (end && end.kind === "date") {
    return { kind: "withheld", reason: "unrepresentableTime" };
  }
  const duration = durationOf(component);
  if (!duration) {
    return { kind: "resolved", time: { kind: "timed", start, end: start, zone } };
  }
  const parsed = parseIcsDuration(duration.text);
  if (!parsed) {
    return { kind: "withheld", reason: "unrepresentableTime" };
  }
  if (parsed.kind === "nominal") {
    return {
      kind: "resolved",
      time: { kind: "timed", start, end: instantOf(startMs + parsed.days * millisecondsInDay), zone },
    };
  }
  return {
    kind: "resolved",
    time: { kind: "timed", start, end: instantOf(startMs + parsed.seconds * millisecondsInSecond), zone },
  };
};

const localCalendarDate = (instant: Instant, zone: ZoneId, zones: ZoneCache): CalendarDate | null => {
  const wall = instantToWallTime(instant, zone, zones);
  if (!wall.value.endsWith("T000000")) {
    return null;
  }
  return calendarDateOf(wall.value.slice(0, 8));
};

const asFullDays = (
  time: Extract<EventTime, { kind: "timed" }>,
  zones: ZoneCache,
): EventTime | null => {
  if (!time.zone) {
    return null;
  }
  const startDate = localCalendarDate(time.start, time.zone, zones);
  const endDate = localCalendarDate(time.end, time.zone, zones);
  if (!startDate || !endDate || endDate.value <= startDate.value) {
    return null;
  }
  return { kind: "allDay", startDate, endDateExclusive: endDate };
};

const interpretedTime = (resolution: TimeResolution, zones: ZoneCache): EventTimeResolution => {
  if (resolution.kind === "withheld") {
    return resolution;
  }
  if (resolution.time.kind !== "timed") {
    return { kind: "resolved", time: resolution.time, fullDayZone: null };
  }
  const fullDays = asFullDays(resolution.time, zones);
  if (!fullDays) {
    return { kind: "resolved", time: resolution.time, fullDayZone: null };
  }
  return { kind: "resolved", time: fullDays, fullDayZone: resolution.time.zone };
};

const withoutReanchoring = (resolution: TimeResolution): EventTimeResolution => {
  if (resolution.kind === "withheld") {
    return resolution;
  }
  return { kind: "resolved", time: resolution.time, fullDayZone: null };
};

const endValueOf = (
  endProperty: PropertyLine | undefined,
  eventZone: string | null,
  document: IcsDocument,
  options: IcsOptions,
): DateValue | null => {
  if (!endProperty) {
    return null;
  }
  return resolveDateValue(endProperty, endProperty.value, eventZone, document, options.zones);
};

const resolveEventTime = (
  component: VeventComponent,
  document: IcsDocument,
  options: IcsOptions,
): EventTimeResolution => {
  const startProperty = propertyNamed(component, "DTSTART");
  if (!startProperty) {
    return { kind: "withheld", reason: "unparseable" };
  }
  const eventZone = eventZoneOf(component);
  const start = resolveDateValue(startProperty, startProperty.value, eventZone, document, options.zones);
  if (start.kind === "unresolved") {
    return { kind: "withheld", reason: start.reason };
  }
  const endProperty = propertyNamed(component, "DTEND");
  const end = endValueOf(endProperty, eventZone, document, options);
  if (start.kind === "date") {
    return withoutReanchoring(allDayEnd(component, start.date, end));
  }
  return interpretedTime(timedEnd(component, start.instant, start.zone, end), options.zones);
};

export { eventZoneOf, propertyNamed, resolveEventTime, shiftedDate };
export type { EventTimeResolution };
