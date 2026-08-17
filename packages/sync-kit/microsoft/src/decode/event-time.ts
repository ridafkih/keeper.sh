import type { CalendarDate, EventTime, Instant, ZoneId } from "@keeper.sh/sync-protocol";
import type { ZoneCache } from "@keeper.sh/sync-ical";
import type { DateTimeTimeZone } from "@microsoft/microsoft-graph-types";
import { calendarDateOfGraphDateTime, instantOfGraphDateTime } from "./zone";

type TimeReading =
  | { readonly kind: "time"; readonly time: EventTime }
  | { readonly kind: "unrepresentable" };

interface TimeInputs {
  readonly start: DateTimeTimeZone | null;
  readonly end: DateTimeTimeZone | null;
  readonly isAllDay: boolean;
  readonly zone: ZoneId | null;
  readonly zones: ZoneCache;
}

const unrepresentable: TimeReading = { kind: "unrepresentable" };

const dateTimeOf = (member: DateTimeTimeZone | null): string | null => {
  const value = member?.dateTime;
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
};

const calendarDateOf = (member: DateTimeTimeZone | null): CalendarDate | null => {
  const dateTime = dateTimeOf(member);
  if (dateTime === null) {
    return null;
  }
  const date = calendarDateOfGraphDateTime(dateTime);
  if (date === null) {
    return null;
  }
  return { kind: "calendarDate", value: date };
};

const instantOf = (
  member: DateTimeTimeZone | null,
  zone: ZoneId,
  zones: ZoneCache,
): Instant | null => {
  const dateTime = dateTimeOf(member);
  if (dateTime === null) {
    return null;
  }
  return instantOfGraphDateTime(dateTime, zone, zones);
};

const decodeAllDay = (inputs: TimeInputs): TimeReading => {
  const startDate = calendarDateOf(inputs.start);
  const endDateExclusive = calendarDateOf(inputs.end);
  if (startDate === null || endDateExclusive === null) {
    return unrepresentable;
  }
  if (endDateExclusive.value < startDate.value) {
    return unrepresentable;
  }
  return { kind: "time", time: { kind: "allDay", startDate, endDateExclusive } };
};

const decodeTimed = (inputs: TimeInputs, zone: ZoneId): TimeReading => {
  const start = instantOf(inputs.start, zone, inputs.zones);
  const end = instantOf(inputs.end, zone, inputs.zones);
  if (start === null || end === null) {
    return unrepresentable;
  }
  if (Date.parse(end.value) < Date.parse(start.value)) {
    return unrepresentable;
  }
  return { kind: "time", time: { kind: "timed", start, end, zone } };
};

const decodeEventTime = (inputs: TimeInputs): TimeReading => {
  if (inputs.isAllDay) {
    return decodeAllDay(inputs);
  }
  const { zone } = inputs;
  if (zone === null) {
    return unrepresentable;
  }
  return decodeTimed(inputs, zone);
};

export { decodeEventTime };
export type { TimeInputs, TimeReading };
