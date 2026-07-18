import type { SourceEvent } from "../../core/types";
import type { FetchEventsResult } from "../../core/sync-engine/ingest";
import type { SafeFetchOptions } from "../../utils/safe-fetch";
import { coerceCompliantDate } from "../patches/coerce-compliant-date";
import { parseIcsCalendarLenient } from "./lenient-parser";
import { parseIcsEvents } from "./parse-ics-events";
import { pullRemoteCalendar } from "./pull-remote-calendar";
import { prepareCalendarSnapshot } from "./create-snapshot";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { normalizeTimezone } from "./normalize-timezone";
import {
  assertNoUnsupportedRecurrenceDates,
  assertSupportedRecurrenceTimeZones,
} from "./validate-recurrence-input";
import { wallTimeToInstant } from "./timezone-instant";

interface IcsSourceFetcherConfig {
  calendarId: string;
  url: string;
  database: BunSQLDatabase;
  safeFetchOptions?: SafeFetchOptions;
}

interface IcsSourceEventContext {
  calendarTimeZone?: string;
}

interface FetchIcsSourceEventsOptions {
  interpretEvents?: (events: SourceEvent[], context: IcsSourceEventContext) => SourceEvent[];
}

interface IcsSourceFetcher {
  fetchEvents: (options?: FetchIcsSourceEventsOptions) => Promise<FetchEventsResult>;
}

const FLOATING_DATE_PROPERTIES = new Set([
  "DTEND",
  "DTSTART",
  "EXDATE",
  "RDATE",
  "RECURRENCE-ID",
]);

const FLOATING_UNTIL_PATTERN = /(^|;)UNTIL=(\d{8}T\d{6})(?=;|$)/i;

const formatUtcIcsDateTime = (date: Date): string =>
  date.toISOString().replaceAll(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

const applyCalendarTimeZoneToFloatingUntil = (
  line: string,
  calendarTimeZone: string | undefined,
): string => {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex === -1 || line.slice(0, separatorIndex).toUpperCase() !== "RRULE") {
    return line;
  }
  const value = line.slice(separatorIndex + 1);
  const match = FLOATING_UNTIL_PATTERN.exec(value);
  const floatingUntil = match?.[2];
  if (!floatingUntil) {
    return line;
  }
  if (!calendarTimeZone) {
    throw new RangeError("Floating ICS RRULE UNTIL requires an explicit X-WR-TIMEZONE");
  }
  const year = Number(floatingUntil.slice(0, 4));
  const month = Number(floatingUntil.slice(4, 6));
  const day = Number(floatingUntil.slice(6, 8));
  const hour = Number(floatingUntil.slice(9, 11));
  const minute = Number(floatingUntil.slice(11, 13));
  const second = Number(floatingUntil.slice(13, 15));
  const wallTime = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const instant = wallTimeToInstant(wallTime, calendarTimeZone);
  const normalizedValue = value.replace(
    FLOATING_UNTIL_PATTERN,
    (matched, prefix: string) => `${prefix}UNTIL=${formatUtcIcsDateTime(instant)}`,
  );
  return `${line.slice(0, separatorIndex + 1)}${normalizedValue}`;
};

const applyCalendarTimeZoneToFloatingEventDates = (
  ical: string,
  calendarTimeZone: string | undefined,
): string => {
  const unfolded = ical.replaceAll(/\r?\n[\t ]/g, "");
  let insideEvent = false;

  return unfolded.split(/\r?\n/).map((line) => {
    if (line.toUpperCase() === "BEGIN:VEVENT") {
      insideEvent = true;
      return line;
    }
    if (line.toUpperCase() === "END:VEVENT") {
      insideEvent = false;
      return line;
    }
    if (!insideEvent) {
      return line;
    }

    if (line.slice(0, line.indexOf(":")).toUpperCase() === "RRULE") {
      return applyCalendarTimeZoneToFloatingUntil(line, calendarTimeZone);
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      return line;
    }
    const property = line.slice(0, separatorIndex);
    const [propertyName, ...parameters] = property.toUpperCase().split(";");
    const value = line.slice(separatorIndex + 1);
    if (
      !propertyName
      || !FLOATING_DATE_PROPERTIES.has(propertyName)
      || property.toUpperCase().includes("TZID=")
      || parameters.includes("VALUE=DATE")
      || value.split(",").every((entry) => entry.endsWith("Z") || /^\d{8}$/.test(entry))
    ) {
      return line;
    }

    if (!calendarTimeZone) {
      throw new RangeError(
        `Floating ICS ${propertyName} requires an explicit TZID or X-WR-TIMEZONE`,
      );
    }
    return `${property};TZID=${calendarTimeZone}:${value}`;
  }).join("\r\n");
};

const createIcsSourceFetcher = (config: IcsSourceFetcherConfig): IcsSourceFetcher => {
  /**
   * Lets pullRemoteCalendar errors propagate. The previous behavior swallowed
   * them and returned null, which caused ingestSource to treat the empty result
   * as "the source authoritatively has zero events" and delete every existing
   * event_state for the calendar on the next tick. Surfacing the error lets the
   * cron mark the run as failed and leave existing events intact for retry.
   */
  const fetchRemoteIcal = async (): Promise<string> => {
    const { ical } = await pullRemoteCalendar("ical", config.url, config.safeFetchOptions);
    return ical;
  };

  const fetchEvents = async (options: FetchIcsSourceEventsOptions = {}): Promise<FetchEventsResult> => {
    const ical = await fetchRemoteIcal();
    if (!ical) {
      /*
       * Defensive: pullRemoteCalendar already throws on invalid/empty bodies,
       * but if a future change ever returns an empty string here, treat it as
       * unchanged rather than authoritative-empty to keep the no-wipe invariant.
       */
      return { events: [], unchanged: true };
    }
    assertNoUnsupportedRecurrenceDates(ical);
    const snapshotResult = await prepareCalendarSnapshot(config.database, config.calendarId, ical);
    const initialCalendar = parseIcsCalendarLenient({
      icsString: ical,
      patches: [coerceCompliantDate],
    });
    const calendarTimeZone = normalizeTimezone(initialCalendar.nonStandard?.wrTimezone);
    const normalizedIcal = applyCalendarTimeZoneToFloatingEventDates(ical, calendarTimeZone);
    let calendar = initialCalendar;
    if (normalizedIcal !== ical) {
      calendar = parseIcsCalendarLenient({
        icsString: normalizedIcal,
        patches: [coerceCompliantDate],
      });
    }
    const parsed = parseIcsEvents(calendar);
    assertSupportedRecurrenceTimeZones(parsed);
    const events: SourceEvent[] = parsed.map((event) => ({
      availability: event.availability,
      description: event.description,
      endTime: event.endTime,
      exceptionDates: event.exceptionDates,
      recurrenceId: event.recurrenceId,
      isAllDay: event.isAllDay,
      location: event.location,
      recurrenceDuration: event.recurrenceDuration,
      recurrenceRule: event.recurrenceRule,
      startTime: event.startTime,
      startTimeZone: event.startTimeZone,
      title: event.title,
      uid: event.uid,
    }));
    if (options.interpretEvents) {
      const result: FetchEventsResult = {
        events: options.interpretEvents(events, {
          calendarTimeZone,
        }),
      };
      if (snapshotResult.changed && snapshotResult.snapshot) {
        result.snapshot = snapshotResult.snapshot;
      }
      return result;
    }
    const result: FetchEventsResult = { events };
    if (snapshotResult.changed && snapshotResult.snapshot) {
      result.snapshot = snapshotResult.snapshot;
    }
    return result;
  };

  return { fetchEvents };
};

export { applyCalendarTimeZoneToFloatingEventDates, createIcsSourceFetcher };
export type {
  FetchIcsSourceEventsOptions,
  IcsSourceEventContext,
  IcsSourceFetcher,
  IcsSourceFetcherConfig,
};
