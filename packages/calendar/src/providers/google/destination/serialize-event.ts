import type { GoogleEvent } from "@keeper.sh/data-schemas";
import type { MaterializedSyncableEvent } from "../../../core/types";
import { inferAllDayEvent, resolveIsAllDayEvent } from "../../../core/events/all-day";
import { KEEPER_EVENT_UID_PROPERTY, toGoogleEventId } from "./ooo-identity";

const HOURS_IN_DAY = 24;
const WALL_CLOCK_ALL_DAY_START = /^(\d{4}-\d{2}-\d{2})T00:00:00/;
const WALL_CLOCK_ALL_DAY_END = /^(\d{4}-\d{2}-\d{2})T23:59:59/;

interface SerializeGoogleEventOptions {
  destinationTimeZone?: string;
  recurrenceRule?: string | null;
}

interface RestoreAllDayOooTimesOptions {
  destinationTimeZone?: string;
  startTimeZone?: string;
}

interface TimedOooDateOptions {
  isAllDay: boolean;
  isEnd: boolean;
  timeZone: string;
}

const isExplicitUtcTimeZone = (timeZone: string | undefined): boolean =>
  timeZone === "UTC"
  || timeZone === "Etc/UTC"
  || timeZone === "Etc/GMT";

const isUtcTimeZone = (timeZone: string | undefined): boolean =>
  !timeZone || isExplicitUtcTimeZone(timeZone);

const formatDateOnly = (value: Date): string => value.toISOString().slice(0, 10);

const shiftUtcDate = (dateOnly: string, days: number): string => {
  const shifted = new Date(`${dateOnly}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return formatDateOnly(shifted);
};

const inclusiveAllDayEndDate = (exclusiveEnd: Date): string =>
  shiftUtcDate(formatDateOnly(exclusiveEnd), -1);

const utcMidnight = (dateOnly: string): Date => new Date(`${dateOnly}T00:00:00.000Z`);

const OFFSET_NAME = /(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?/i;

const formatRfc3339Offset = (sign: string, hours: string, minutes: string): string =>
  `${sign}${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}`;

/** Offset at local noon on a DATE, e.g. Europe/Berlin in August → +02:00. */
const rfc3339OffsetForTimeZone = (timeZone: string, dateOnly: string): string | null => {
  try {
    const probe = new Date(`${dateOnly}T12:00:00.000Z`);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
      year: "numeric",
    }).formatToParts(probe);
    const name = parts.find((part) => part.type === "timeZoneName")?.value;
    if (!name) {
      return null;
    }
    if (name === "GMT" || name === "UTC") {
      return "+00:00";
    }
    const match = OFFSET_NAME.exec(name);
    if (!match?.[1] || !match[2]) {
      return null;
    }
    return formatRfc3339Offset(match[1], match[2], match[3] ?? "00");
  } catch {
    return null;
  }
};

const exclusiveAllDayRange = (
  startDate: string,
  inclusiveEndDate: string,
): { startTime: Date; endTime: Date; isAllDay: true } => ({
  startTime: utcMidnight(startDate),
  endTime: utcMidnight(shiftUtcDate(inclusiveEndDate, 1)),
  isAllDay: true,
});

const matchWallClockDate = (value: string | undefined, pattern: RegExp): string | null => {
  if (!value) {
    return null;
  }
  const match = pattern.exec(value);
  if (!match?.[1]) {
    return null;
  }
  return match[1];
};

const buildDateField = (
  time: Date,
  isAllDay: boolean,
  startTimeZone: string | undefined,
  recurrenceRule: string | null | undefined,
): NonNullable<GoogleEvent["start"]> => {
  if (isAllDay) {
    return { date: formatDateOnly(time) };
  }

  const timeZone = startTimeZone ?? "UTC";
  return {
    dateTime: time.toISOString(),
    ...(recurrenceRule && { timeZone }),
  };
};

const buildTimedOooDateField = (
  time: Date,
  options?: TimedOooDateOptions,
): NonNullable<GoogleEvent["start"]> => {
  if (!options?.isAllDay) {
    return { dateTime: time.toISOString() };
  }

  let dateOnly = formatDateOnly(time);
  let clock = "00:00:00";
  if (options.isEnd) {
    dateOnly = inclusiveAllDayEndDate(time);
    clock = "23:59:59";
  }
  let dateTime = `${dateOnly}T${clock}`;
  if (!isUtcTimeZone(options.timeZone)) {
    const offset = rfc3339OffsetForTimeZone(options.timeZone, dateOnly);
    if (offset) {
      dateTime = `${dateTime}${offset}`;
    }
  }
  return { dateTime };
};

const canSerializeGoogleEvent = (event: MaterializedSyncableEvent): boolean => {
  if (event.availability === "workingElsewhere") {
    return false;
  }

  return true;
};

const serializeGoogleEvent = (
  event: MaterializedSyncableEvent,
  uid: string,
  options: SerializeGoogleEventOptions = {},
): GoogleEvent | null => {
  if (!canSerializeGoogleEvent(event)) {
    return null;
  }

  const isAllDay = resolveIsAllDayEvent(event);
  const { recurrenceRule, destinationTimeZone } = options;

  if (event.availability === "oof") {
    const timeZone = destinationTimeZone || event.startTimeZone || "";
    let start = buildTimedOooDateField(event.startTime);
    let end = buildTimedOooDateField(event.endTime);
    if (isAllDay) {
      start = buildTimedOooDateField(event.startTime, { isAllDay: true, isEnd: false, timeZone });
      end = buildTimedOooDateField(event.endTime, { isAllDay: true, isEnd: true, timeZone });
    }
    return {
      description: event.description,
      end,
      eventType: "outOfOffice",
      extendedProperties: {
        private: { [KEEPER_EVENT_UID_PROPERTY]: uid },
      },
      id: toGoogleEventId(uid),
      location: event.location,
      outOfOfficeProperties: {
        autoDeclineMode: "declineAllConflictingInvitations",
      },
      start,
      summary: event.summary,
      transparency: "opaque",
      ...(recurrenceRule && { recurrence: [`RRULE:${recurrenceRule}`] }),
    };
  }

  return {
    description: event.description,
    end: buildDateField(event.endTime, isAllDay, event.startTimeZone, recurrenceRule),
    iCalUID: uid,
    location: event.location,
    start: buildDateField(event.startTime, isAllDay, event.startTimeZone, recurrenceRule),
    summary: event.summary,
    ...(event.availability === "free" && { transparency: "transparent" }),
    ...(recurrenceRule && { recurrence: [`RRULE:${recurrenceRule}`] }),
  };
};

const isLegacyUtcOooInstant = (
  startDateTime: string | undefined,
  endDateTime: string | undefined,
  options: RestoreAllDayOooTimesOptions | undefined,
): boolean =>
  Boolean(startDateTime?.endsWith("Z") && endDateTime?.endsWith("Z"))
  && isUtcTimeZone(options?.startTimeZone)
  && !isExplicitUtcTimeZone(options?.destinationTimeZone);

const wallClockInTimeZone = (
  instant: Date,
  timeZone: string,
): { date: string; time: string } | null => {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const lookup = new Map<string, string>();
    for (const part of formatter.formatToParts(instant)) {
      lookup.set(part.type, part.value);
    }
    const read = (type: string): string => lookup.get(type) ?? "0";
    let hour = Number.parseInt(read("hour"), 10);
    if (hour === HOURS_IN_DAY) {
      hour = 0;
    }
    return {
      date: `${read("year")}-${read("month").padStart(2, "0")}-${read("day").padStart(2, "0")}`,
      time: `${hour.toString().padStart(2, "0")}:${read("minute").padStart(2, "0")}:${read("second").padStart(2, "0")}`,
    };
  } catch {
    return null;
  }
};

/**
 * Map timed Google OOO back to exclusive UTC all-day dates so mapping times match.
 * Legacy UTC-Z writes on a non-UTC calendar are left unrestored so the next sync rewrites them.
 */
const restoreAllDayOooTimes = (
  startDateTime: string | undefined,
  endDateTime: string | undefined,
  parsedStart: Date,
  parsedEnd: Date,
  options?: RestoreAllDayOooTimesOptions,
): { startTime: Date; endTime: Date; isAllDay: boolean } => {
  const startDate = matchWallClockDate(startDateTime, WALL_CLOCK_ALL_DAY_START);
  const endDate = matchWallClockDate(endDateTime, WALL_CLOCK_ALL_DAY_END);
  const skipLegacyUtc = isLegacyUtcOooInstant(startDateTime, endDateTime, options);

  if (startDate && endDate && !skipLegacyUtc) {
    return exclusiveAllDayRange(startDate, endDate);
  }

  const eventTimeZone = options?.startTimeZone;
  if (eventTimeZone && !isUtcTimeZone(eventTimeZone)) {
    const startWall = wallClockInTimeZone(parsedStart, eventTimeZone);
    const endWall = wallClockInTimeZone(parsedEnd, eventTimeZone);
    if (startWall?.time === "00:00:00" && endWall?.time === "23:59:59") {
      return exclusiveAllDayRange(startWall.date, endWall.date);
    }
  }

  if (skipLegacyUtc) {
    return { startTime: parsedStart, endTime: parsedEnd, isAllDay: true };
  }

  const exclusiveEnd = new Date(parsedEnd.getTime() + 1000);
  if (inferAllDayEvent({ endTime: exclusiveEnd, startTime: parsedStart })) {
    return { startTime: parsedStart, endTime: exclusiveEnd, isAllDay: true };
  }

  return {
    startTime: parsedStart,
    endTime: parsedEnd,
    isAllDay: inferAllDayEvent({ endTime: parsedEnd, startTime: parsedStart }),
  };
};

export {
  canSerializeGoogleEvent,
  restoreAllDayOooTimes,
  serializeGoogleEvent,
};
export type { RestoreAllDayOooTimesOptions, SerializeGoogleEventOptions };
