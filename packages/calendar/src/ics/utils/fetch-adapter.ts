import type { SourceEvent } from "../../core/types";
import type { FetchEventsResult } from "../../core/sync-engine/ingest";
import { pullRemoteCalendar } from "./pull-remote-calendar";
import { parseIcsCalendar } from "./parse-ics-calendar";
import { parseIcsEvents } from "./parse-ics-events";
import { createSnapshot } from "./create-snapshot";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

interface IcsSourceFetcherConfig {
  calendarId: string;
  url: string;
  database: BunSQLDatabase;
}

interface IcsSourceFetcher {
  fetchEvents: () => Promise<FetchEventsResult>;
}

const createIcsSourceFetcher = (config: IcsSourceFetcherConfig): IcsSourceFetcher => {
  const fetchRemoteIcal = async (): Promise<string | null> => {
    try {
      const { ical } = await pullRemoteCalendar("ical", config.url);
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

    const { changed } = await createSnapshot(config.database, config.calendarId, ical);

    if (!changed) {
      return { events: [] };
    }

    const calendar = parseIcsCalendar({ icsString: ical });
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
