import type { calendar_v3 } from "@googleapis/calendar";
import type { CalendarDate, EventTime, Instant, WithholdReason, ZoneId } from "@keeper.sh/sync-protocol";

type DecodedTime =
  | { readonly kind: "time"; readonly time: EventTime }
  | { readonly kind: "undecodable"; readonly reason: WithholdReason };

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

const resolvesAsZone = (value: string): boolean => {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone
      .length > 0;
  } catch {
    return false;
  }
};

const decodeZoneId = (value: string | null | undefined): ZoneId | null => {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  if (!resolvesAsZone(value)) {
    return null;
  }
  return { kind: "zoneId", value };
};

const decodeInstant = (value: string | null | undefined): Instant | null => {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return { kind: "instant", value: new Date(parsed).toISOString() };
};

const decodeCalendarDate = (value: string | null | undefined): CalendarDate | null => {
  if (typeof value !== "string" || !dateOnly.test(value)) {
    return null;
  }
  if (Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) {
    return null;
  }
  return { kind: "calendarDate", value };
};

const unresolvedZone = (member: calendar_v3.Schema$EventDateTime): boolean => {
  const named = member.timeZone;
  if (typeof named !== "string" || named.length === 0) {
    return false;
  }
  return decodeZoneId(named) === null;
};

const undecodable = (reason: WithholdReason): DecodedTime => ({ kind: "undecodable", reason });

const decodeAllDay = (
  start: calendar_v3.Schema$EventDateTime,
  end: calendar_v3.Schema$EventDateTime,
): DecodedTime => {
  const startDate = decodeCalendarDate(start.date);
  const endDateExclusive = decodeCalendarDate(end.date);
  if (startDate === null || endDateExclusive === null) {
    return undecodable("unrepresentableTime");
  }
  return { kind: "time", time: { kind: "allDay", startDate, endDateExclusive } };
};

const decodeTimed = (
  start: calendar_v3.Schema$EventDateTime,
  end: calendar_v3.Schema$EventDateTime,
): DecodedTime => {
  if (unresolvedZone(start) || unresolvedZone(end)) {
    return undecodable("unresolvableTimeZone");
  }
  const from = decodeInstant(start.dateTime);
  const until = decodeInstant(end.dateTime);
  if (from === null || until === null) {
    return undecodable("unrepresentableTime");
  }
  if (Date.parse(until.value) < Date.parse(from.value)) {
    return undecodable("unrepresentableTime");
  }
  return {
    kind: "time",
    time: { kind: "timed", start: from, end: until, zone: decodeZoneId(start.timeZone) },
  };
};

const decodeEventTime = (
  start: calendar_v3.Schema$EventDateTime | null | undefined,
  end: calendar_v3.Schema$EventDateTime | null | undefined,
): DecodedTime => {
  if (!start || !end) {
    return undecodable("unrepresentableTime");
  }
  if (typeof start.date === "string" || typeof end.date === "string") {
    return decodeAllDay(start, end);
  }
  return decodeTimed(start, end);
};

export { decodeCalendarDate, decodeEventTime, decodeInstant, decodeZoneId };
export type { DecodedTime };
