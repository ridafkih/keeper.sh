import type { SourceEvent } from "../../core/types";
import type { FetchEventsResult } from "../../core/sync-engine/ingest";
import type { SafeFetchOptions } from "../../utils/safe-fetch";
import { coerceCompliantDate } from "../patches/coerce-compliant-date";
import { parseIcsCalendarLenient } from "./lenient-parser";
import { parseIcsEvents } from "./parse-ics-events";
import { pullRemoteCalendar } from "./pull-remote-calendar";
import { createSnapshot } from "./create-snapshot";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

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
    const { changed } = await createSnapshot(config.database, config.calendarId, ical);
    if (!changed) {
      return { events: [], unchanged: true };
    }
    const calendar = parseIcsCalendarLenient({
      icsString: ical,
      patches: [coerceCompliantDate],
    });
    const parsed = parseIcsEvents(calendar);
    const events: SourceEvent[] = parsed.map((event) => ({
      availability: event.availability,
      description: event.description,
      plaintextDescription: event.plaintextDescription,
      plaintextDescriptionDerivationError: event.plaintextDescriptionDerivationError,
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
      return {
        events: options.interpretEvents(events, {
          calendarTimeZone: calendar.nonStandard?.wrTimezone,
        }),
      };
    }
    return { events };
  };

  return { fetchEvents };
};

export { createIcsSourceFetcher };
export type {
  FetchIcsSourceEventsOptions,
  IcsSourceEventContext,
  IcsSourceFetcher,
  IcsSourceFetcherConfig,
};
