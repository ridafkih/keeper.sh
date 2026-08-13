import type {
  IcsCalendar,
  IcsDateObject,
  IcsEvent,
  IcsTimezone,
  NonStandardValuesGeneric,
} from "ts-ics";
import { normalizeTimezone } from "./normalize-timezone";
import {
  formatIcsUtcOffset,
  getTimeZoneOffsetMinutes,
  isSupportedTimeZone,
  wallTimeToInstant,
} from "./timezone-instant";

/*
 * The ts-ics parser turns a TZID-qualified wall time into an instant by projecting
 * the VTIMEZONE observances, and its RRULE expansion drops the time of day from the
 * onset: every projected transition is applied from local midnight instead of the
 * hour the observance DTSTART names. A wall time in the hours before a transition
 * therefore lands on the wrong side of it — Keeper reads its own CalDAV writes
 * back, so a mirrored event near a DST boundary looks moved and is deleted and
 * re-created on every run.
 *
 * A recurring observance is therefore only trustworthy for identifiers the platform
 * cannot answer for; where the TZID names a zone IANA knows, the IANA rules decide.
 * An observance set with no RRULE states every onset outright, ts-ics reads it
 * correctly, and it stays authoritative over IANA as RFC 5545 §3.6.5 intends.
 */
const hasProjectedObservance = (timezone: IcsTimezone): boolean =>
  timezone.props.some((observance) => Boolean(observance.recurrenceRule));

const collectProjectedTimeZoneIds = (timezones: IcsTimezone[] | undefined): Set<string> =>
  new Set(
    (timezones ?? [])
      .filter((timezone) => hasProjectedObservance(timezone))
      .map((timezone) => timezone.id),
  );

const collectDeclaredTimeZoneIds = (timezones: IcsTimezone[] | undefined): Set<string> =>
  new Set((timezones ?? []).map((timezone) => timezone.id));

interface ZonedInstantScope {
  declaredTimeZoneIds: Set<string>;
  projectedTimeZoneIds: Set<string>;
}

const isIanaAuthoritative = (timeZoneId: string, scope: ZonedInstantScope): boolean =>
  scope.projectedTimeZoneIds.has(timeZoneId) || !scope.declaredTimeZoneIds.has(timeZoneId);

const resolveZonedInstant = (
  value: IcsDateObject,
  scope: ZonedInstantScope,
): IcsDateObject => {
  const { local } = value;
  if (!local || !isIanaAuthoritative(local.timezone, scope)) {
    return value;
  }
  const timeZone = normalizeTimezone(local.timezone);
  if (!timeZone || !isSupportedTimeZone(timeZone)) {
    return value;
  }
  const date = wallTimeToInstant(local.date, timeZone);
  if (date.getTime() === value.date.getTime()) {
    return value;
  }
  return {
    ...value,
    date,
    local: {
      ...local,
      tzoffset: formatIcsUtcOffset(getTimeZoneOffsetMinutes(date, timeZone)),
    },
  };
};

const resolveEventZonedInstants = <TNonStandardValues extends NonStandardValuesGeneric>(
  event: IcsEvent<TNonStandardValues>,
  scope: ZonedInstantScope,
): IcsEvent<TNonStandardValues> => {
  const resolve = (value: IcsDateObject): IcsDateObject => resolveZonedInstant(value, scope);
  const patch = {
    ...event.created && { created: resolve(event.created) },
    ...event.exceptionDates && { exceptionDates: event.exceptionDates.map(resolve) },
    ...event.lastModified && { lastModified: resolve(event.lastModified) },
    ...event.recurrenceId && {
      recurrenceId: { ...event.recurrenceId, value: resolve(event.recurrenceId.value) },
    },
    ...event.recurrenceRule?.until && {
      recurrenceRule: { ...event.recurrenceRule, until: resolve(event.recurrenceRule.until) },
    },
    ...event.stamp && { stamp: resolve(event.stamp) },
    ...event.start && { start: resolve(event.start) },
  };
  if ("end" in event && event.end) {
    return { ...event, ...patch, end: resolve(event.end) };
  }
  return { ...event, ...patch };
};

const resolveCalendarZonedInstants = <TNonStandardValues extends NonStandardValuesGeneric>(
  calendar: IcsCalendar<TNonStandardValues>,
): IcsCalendar<TNonStandardValues> => {
  if (!calendar.events) {
    return calendar;
  }
  const scope: ZonedInstantScope = {
    declaredTimeZoneIds: collectDeclaredTimeZoneIds(calendar.timezones),
    projectedTimeZoneIds: collectProjectedTimeZoneIds(calendar.timezones),
  };
  return {
    ...calendar,
    events: calendar.events.map((event) => resolveEventZonedInstants(event, scope)),
  };
};

export { resolveCalendarZonedInstants };
