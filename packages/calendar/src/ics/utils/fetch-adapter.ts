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
import { resolveTimeZone } from "./timezone-instant";

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

const assertNoUnsupportedRecurrenceDates = (ical: string): void => {
  const unfolded = ical.replaceAll(/\r?\n[\t ]/g, "");
  let insideEvent = false;
  for (const line of unfolded.split(/\r?\n/)) {
    const normalizedLine = line.toUpperCase();
    if (normalizedLine === "BEGIN:VEVENT") {
      insideEvent = true;
      continue;
    }
    if (normalizedLine === "END:VEVENT") {
      insideEvent = false;
      continue;
    }
    if (!insideEvent) {
      continue;
    }
    const [propertyName] = normalizedLine.split(/[:;]/, 1);
    if (propertyName === "RDATE") {
      throw new RangeError("ICS RDATE recurrence is not supported");
    }
  }
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
    for (const event of parsed) {
      if (event.recurrenceRule) {
        resolveTimeZone(event.startTimeZone);
      }
    }
    const events: SourceEvent[] = parsed.map((event) => ({
      availability: event.availability,
      description: event.description,
      endTime: event.endTime,
      exceptionDates: event.exceptionDates,
      recurrenceId: event.recurrenceId,
      isAllDay: event.isAllDay,
      location: event.location,
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
