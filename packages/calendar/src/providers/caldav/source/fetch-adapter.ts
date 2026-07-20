import type { SourceEvent } from "../../../core/types";
import type { SyncRange } from "@keeper.sh/data-schemas";
import type { ConfigurableSyncWindow } from "../../../core/sync/sync-range";
import type { FetchEventsResult } from "../../../core/sync-engine/ingest";
import type { SafeFetchOptions } from "../../../utils/safe-fetch";
import { isKeeperEvent } from "../../../core/events/identity";
import {
  DEFAULT_FUTURE_SYNC_RANGE,
  DEFAULT_HISTORIC_SYNC_RANGE,
  getConfigurableSyncWindow,
} from "../../../core/sync/sync-range";
import { CalDAVClient } from "../shared/client";
import { parseICalCalendarsToRemoteEvents } from "../shared/ics";

interface CalDAVSourceFetcherConfig {
  authMethod?: "basic" | "digest";
  calendarUrl: string;
  serverUrl: string;
  username: string;
  password: string;
  safeFetchOptions?: SafeFetchOptions;
  syncWindow?: ConfigurableSyncWindow;
  historicRange?: SyncRange;
  futureRange?: SyncRange;
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
    const historicRange = config.historicRange ?? DEFAULT_HISTORIC_SYNC_RANGE;
    const futureRange = config.futureRange ?? DEFAULT_FUTURE_SYNC_RANGE;
    const syncWindow = config.syncWindow ?? getConfigurableSyncWindow(
      historicRange,
      futureRange,
    );
    const calendarUrl = await client.resolveCalendarUrl(config.calendarUrl);

    const objects = await client.fetchCalendarObjects({
      calendarUrl,
      timeRange: {
        end: syncWindow.timeMax.toISOString(),
        start: syncWindow.timeMin.toISOString(),
      },
    });

    const events: SourceEvent[] = [];
    const parsedEvents = parseICalCalendarsToRemoteEvents(
      objects.flatMap(({ data }) => {
        if (!data) {
          return [];
        }
        return [data];
      }),
    );

    for (const parsed of parsedEvents) {
      if (isKeeperEvent(parsed.uid)) {
        continue;
      }
      /*
       * Non-recurring events that ended before the sync window are out of scope.
       * Recurring events with a master DTSTART before the window are kept: their
       * occurrences within the window were already returned by the CalDAV time-range
       * filter, and downstream RRULE expansion handles the rest.
       */
      if (!parsed.recurrenceRule && parsed.endTime < syncWindow.timeMin) {
        continue;
      }

      events.push({
        availability: parsed.availability,
        description: parsed.description,
        endTime: parsed.endTime,
        exceptionDates: parsed.exceptionDates,
        recurrenceId: parsed.recurrenceId,
        isAllDay: parsed.isAllDay,
        location: parsed.location,
        recurrenceDuration: parsed.recurrenceDuration,
        recurrenceRule: parsed.recurrenceRule,
        startTime: parsed.startTime,
        startTimeZone: parsed.startTimeZone,
        title: parsed.title,
        uid: parsed.uid,
      });
    }

    return {
      events,
      syncWindow,
      coverage: {
        futureRange,
        historicRange,
        window: syncWindow,
      },
    };
  };

  return { fetchEvents };
};

export { createCalDAVSourceFetcher };
export type { CalDAVSourceFetcherConfig, CalDAVSourceFetcher };
