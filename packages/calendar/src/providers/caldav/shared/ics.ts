import { generateIcsCalendar } from "ts-ics";
import {
  applyCalendarTimeZoneToFloatingEventDates,
  buildVtimezone,
  buildZonedIcsDate,
  normalizeTimezone,
  parseIcsCalendar,
  parseIcsEvents,
} from "../../../ics";
import type {
  IcsCalendar,
  IcsEvent,
  IcsExceptionDates,
  IcsRecurrenceRule,
  IcsTimezone,
} from "ts-ics";
import type { MaterializedSyncableEvent, SyncableEvent } from "../../../core/types";
import { isKeeperEvent } from "../../../core/events/identity";
import { resolveIsAllDayEvent } from "../../../core/events/all-day";
import {
  assertNoUnsupportedRecurrenceDates,
  assertSupportedRecurrenceTimeZones,
} from "../../../ics/utils/validate-recurrence-input";

const normalizeIcsText = (value: string | undefined): string | undefined =>
  value?.replaceAll(/\r\n?/g, "\n");

/*
 * A TZID-qualified DTSTART is only interpretable against a VTIMEZONE. Omitting
 * it leaves every reader guessing the offset, and Keeper reads its own writes
 * back: the guess lands on the wrong side of a DST transition, the event looks
 * changed, and the destination is replaced on every run forever.
 */
const resolveEventTimezones = (
  event: MaterializedSyncableEvent,
  isAllDay: boolean,
): IcsTimezone[] => {
  if (isAllDay) {
    return [];
  }
  const timezone = buildVtimezone(event.startTimeZone, event.startTime);
  if (!timezone) {
    return [];
  }
  return [timezone];
};

const eventToICalString = (event: MaterializedSyncableEvent, uid: string): string => {
  const isAllDay = resolveIsAllDayEvent(event);
  const timezones = resolveEventTimezones(event, isAllDay);
  const icsEvent: IcsEvent = {
    description: normalizeIcsText(event.description),
    end: buildZonedIcsDate(event.endTime, event.startTimeZone, isAllDay),
    location: normalizeIcsText(event.location),
    stamp: { date: new Date() },
    start: buildZonedIcsDate(event.startTime, event.startTimeZone, isAllDay),
    summary: event.summary.replaceAll(/\r\n?/g, "\n"),
    ...(event.availability === "free" && { timeTransparent: "TRANSPARENT" }),
    uid,
  };

  const calendar: IcsCalendar = {
    events: [icsEvent],
    prodId: "-//Keeper//Keeper Calendar//EN",
    version: "2.0",
    ...(timezones.length > 0 && { timezones }),
  };

  return generateIcsCalendar(calendar);
};

interface ParsedCalendarEvent {
  availability?: SyncableEvent["availability"];
  deleteId: string;
  endTime: Date;
  isKeeperEvent: boolean;
  isAllDay?: boolean;
  startTime: Date;
  uid: string;
  title?: string;
  description?: string;
  location?: string;
  startTimeZone?: string;
  recurrenceRule?: IcsRecurrenceRule;
  recurrenceDuration?: SyncableEvent["recurrenceDuration"];
  exceptionDates?: IcsExceptionDates;
  recurrenceId?: Date;
}

interface ParseICalCalendarsOptions {
  rejectUnsupportedRecurrenceDates?: boolean;
}

interface ParsedCalendarResources {
  events: ParsedCalendarEvent[];
  skippedResourceCount: number;
  skippedResourceReasons: string[];
}

class CalDAVUnreadableResourceError extends Error {
  readonly skippedResourceCount: number;
  readonly skippedResourceReasons: string[];

  constructor(resources: Pick<
    ParsedCalendarResources,
    "skippedResourceCount" | "skippedResourceReasons"
  >) {
    super(
      `${resources.skippedResourceCount} CalDAV resource(s) could not be read: ${resources.skippedResourceReasons.join("; ")}`,
    );
    this.name = "CalDAVUnreadableResourceError";
    this.skippedResourceCount = resources.skippedResourceCount;
    this.skippedResourceReasons = resources.skippedResourceReasons;
  }
}

/*
 * Skipping is only safe where a missing event means "stale", never where it
 * means "absent". The destination reconciler re-creates any Keeper event it
 * cannot see remotely, so an unreadable Keeper resource would be duplicated on
 * every run instead of repaired.
 */
const assertAllResourcesRead = (resources: ParsedCalendarResources): void => {
  if (resources.skippedResourceCount > 0) {
    throw new CalDAVUnreadableResourceError(resources);
  }
};

const parseCalendarResource = (
  icsString: string,
  options: ParseICalCalendarsOptions,
): IcsCalendar => {
  if (options.rejectUnsupportedRecurrenceDates !== false) {
    assertNoUnsupportedRecurrenceDates(icsString);
  }
  const initialCalendar = parseIcsCalendar({ icsString });
  const normalizedIcs = applyCalendarTimeZoneToFloatingEventDates(
    icsString,
    normalizeTimezone(initialCalendar.nonStandard?.wrTimezone),
  );
  if (normalizedIcs === icsString) {
    return initialCalendar;
  }
  return parseIcsCalendar({ icsString: normalizedIcs });
};

const toResourceFailure = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
};

const parseICalCalendarsToRemoteEvents = (
  icsStrings: string[],
  options: ParseICalCalendarsOptions = {},
): ParsedCalendarResources => {
  const calendars: IcsCalendar[] = [];
  const failures: Error[] = [];
  for (const icsString of icsStrings) {
    try {
      calendars.push(parseCalendarResource(icsString, options));
    } catch (error) {
      failures.push(toResourceFailure(error));
    }
  }
  const skippedResourceReasons = failures.map(({ message }) => message);
  const [firstCalendar] = calendars;
  if (!firstCalendar) {
    /*
     * An empty result is authoritative downstream: ingestion would read it as
     * "the collection has no events" and delete the stored state. Only report
     * that when the collection really was empty, never when every resource in
     * it failed to parse.
     */
    if (failures.length > 0) {
      throw new CalDAVUnreadableResourceError({
        skippedResourceCount: failures.length,
        skippedResourceReasons,
      });
    }
    return { events: [], skippedResourceCount: 0, skippedResourceReasons };
  }
  const calendar = {
    ...firstCalendar,
    events: calendars.flatMap((entry) => entry.events ?? []),
  };
  const parsedEvents = parseIcsEvents(calendar, { includeKeeperEvents: true });
  assertSupportedRecurrenceTimeZones(parsedEvents);
  const events = parsedEvents.map((event) => ({
    availability: event.availability ?? "busy",
    deleteId: event.uid,
    description: event.description,
    endTime: event.endTime,
    exceptionDates: event.exceptionDates,
    recurrenceId: event.recurrenceId,
    isKeeperEvent: isKeeperEvent(event.uid),
    isAllDay: event.isAllDay,
    location: event.location,
    recurrenceDuration: event.recurrenceDuration,
    recurrenceRule: event.recurrenceRule,
    startTime: event.startTime,
    startTimeZone: event.startTimeZone,
    title: event.title,
    uid: event.uid,
  }));
  return {
    events,
    skippedResourceCount: skippedResourceReasons.length,
    skippedResourceReasons,
  };
};

const parseICalToRemoteEvents = (icsString: string): ParsedCalendarEvent[] =>
  parseICalCalendarsToRemoteEvents([icsString]).events;

const parseICalToRemoteEvent = (icsString: string): ParsedCalendarEvent | null => {
  const [event] = parseICalToRemoteEvents(icsString);
  return event ?? null;
};

export {
  assertAllResourcesRead,
  CalDAVUnreadableResourceError,
  eventToICalString,
  parseICalCalendarsToRemoteEvents,
  parseICalToRemoteEvent,
  parseICalToRemoteEvents,
};
export type { ParseICalCalendarsOptions, ParsedCalendarResources };
