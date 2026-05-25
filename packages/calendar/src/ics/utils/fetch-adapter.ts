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

interface IcsSourceFetcher {
  fetchEvents: () => Promise<FetchEventsResult>;
}

const createIcsSourceFetcher = (
  config: IcsSourceFetcherConfig,
): IcsSourceFetcher => {
  const fetchRemoteIcal = async (): Promise<string | null> => {
    try {
      const { ical } = await pullRemoteCalendar(
        "ical",
        config.url,
        config.safeFetchOptions,
      );
      return ical;
    } catch {
      return null;
    }
  };

  const fetchEvents = async (): Promise<FetchEventsResult> => {
    const ical = await fetchRemoteIcal();

    if (!ical) {
      return { events: [] };
    }

    const { changed } = await createSnapshot(
      config.database,
      config.calendarId,
      ical,
    );

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
      endTime: event.endTime,
      exceptionDates: event.exceptionDates,
      isAllDay: event.isAllDay,
      location: event.location,
      recurrenceRule: event.recurrenceRule,
      startTime: event.startTime,
      startTimeZone: event.startTimeZone,
      title: event.title,
      uid: event.uid,
    }));

    return { events };
  };

  return { fetchEvents };
};

export { createIcsSourceFetcher };
export type { IcsSourceFetcherConfig, IcsSourceFetcher };
