import type { SourceIngestionPlan } from "../../../core/sync/sync-range";
import type { FetchEventsResult } from "../../../core/sync-engine/ingest";
import type { SafeFetchOptions } from "../../../utils/safe-fetch";
import { buildCalDAVSourceEvents, isCalDAVEventInSyncWindow } from "./window";
import { CalDAVClient } from "../shared/client";
import { parseICalCalendarsToRemoteEvents } from "../shared/ics";

interface CalDAVSourceFetcherConfig {
  authMethod?: "basic" | "digest";
  calendarUrl: string;
  serverUrl: string;
  username: string;
  password: string;
  safeFetchOptions?: SafeFetchOptions;
  plan: SourceIngestionPlan;
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
    const { futureRange, historicRange, window: syncWindow } = config.plan;
    const calendarUrl = await client.resolveCalendarUrl(config.calendarUrl);

    const objects = await client.fetchCalendarObjects({
      calendarUrl,
      timeRange: {
        end: syncWindow.timeMax.toISOString(),
        start: syncWindow.timeMin.toISOString(),
      },
    });

    const resources = parseICalCalendarsToRemoteEvents(
      objects.flatMap(({ data }) => {
        if (!data) {
          return [];
        }
        return [data];
      }),
    );
    const events = buildCalDAVSourceEvents(resources.events, syncWindow);

    return {
      events,
      syncWindow,
      coverage: {
        futureRange,
        historicRange,
        window: syncWindow,
      },
      skippedResourceCount: resources.skippedResourceCount,
      skippedResourceReasons: resources.skippedResourceReasons,
    };
  };

  return { fetchEvents };
};

export { createCalDAVSourceFetcher, isCalDAVEventInSyncWindow };
export type { CalDAVSourceFetcherConfig, CalDAVSourceFetcher };
