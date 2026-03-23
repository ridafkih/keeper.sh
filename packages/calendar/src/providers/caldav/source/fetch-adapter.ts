import type { SourceEvent } from "../../../core/types";
import type { FetchEventsResult } from "../../../core/sync-engine/ingest";
import type { SafeFetchOptions } from "../../../utils/safe-fetch";
import { isKeeperEvent } from "../../../core/events/identity";
import { CalDAVClient } from "../shared/client";
import { parseICalToRemoteEvent } from "../shared/ics";
import { getCalDAVSyncWindow } from "../shared/sync-window";

const YEARS_UNTIL_FUTURE = 2;

interface CalDAVSourceFetcherConfig {
  authMethod?: "basic" | "digest";
  calendarUrl: string;
  serverUrl: string;
  username: string;
  password: string;
  safeFetchOptions?: SafeFetchOptions;
}

interface CalDAVSourceFetcher {
  fetchEvents: () => Promise<FetchEventsResult>;
}

const createCalDAVSourceFetcher = (config: CalDAVSourceFetcherConfig): CalDAVSourceFetcher => {
  const client = new CalDAVClient({
    authMethod: config.authMethod,
    credentials: { password: config.password, username: config.username },
    serverUrl: config.serverUrl,
  }, config.safeFetchOptions);

  const fetchEvents = async (): Promise<FetchEventsResult> => {
    const syncWindow = getCalDAVSyncWindow(YEARS_UNTIL_FUTURE);
    const calendarUrl = await client.resolveCalendarUrl(config.calendarUrl);

    const objects = await client.fetchCalendarObjects({
      calendarUrl,
      timeRange: {
        end: syncWindow.end.toISOString(),
        start: syncWindow.start.toISOString(),
      },
    });

    const events: SourceEvent[] = [];

    for (const { data } of objects) {
      if (!data) {
        continue;
      }

      const parsed = parseICalToRemoteEvent(data);

      if (!parsed || isKeeperEvent(parsed.uid) || parsed.endTime < syncWindow.start) {
        continue;
      }

      events.push({
        availability: parsed.availability,
        description: parsed.description,
        endTime: parsed.endTime,
        exceptionDates: parsed.exceptionDates,
        isAllDay: parsed.isAllDay,
        location: parsed.location,
        recurrenceRule: parsed.recurrenceRule,
        startTime: parsed.startTime,
        startTimeZone: parsed.startTimeZone,
        title: parsed.title,
        uid: parsed.uid,
      });
    }

    return { events };
  };

  return { fetchEvents };
};

export { createCalDAVSourceFetcher };
export type { CalDAVSourceFetcherConfig, CalDAVSourceFetcher };
