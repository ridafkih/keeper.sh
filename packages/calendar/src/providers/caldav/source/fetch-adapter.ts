import type { SourceIngestionPlan } from "../../../core/sync/sync-range";
import type { FetchEventsResult } from "../../../core/sync-engine/ingest";
import type { SafeFetchOptions } from "../../../utils/safe-fetch";
import { isCalDAVEventInSyncWindow, partitionCalDAVSourceEvents } from "./window";
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

    /*
     * An empty body is an unread resource, not an absent one; it must reach the
     * parser to be counted as skipped.
     */
    const resources = parseICalCalendarsToRemoteEvents(objects.map(({ data }) => data ?? ""));
    const { events, outsideSyncWindowCount, selfAuthoredEventCount } = partitionCalDAVSourceEvents(
      resources.events,
      syncWindow,
    );

    return {
      events,
      discardedEventCounts: {
        outsideSyncWindow: outsideSyncWindowCount,
        unrepresentable: resources.unrepresentableEventCount,
      },
      selfAuthoredEventCount,
      syncWindow,
      coverage: {
        futureRange,
        historicRange,
        window: syncWindow,
      },
      skippedResourceCount: resources.skippedResourceCount,
      skippedResourceReasons: resources.skippedResourceReasons,
      ...resources.unsupportedEvents.length > 0 && {
        unsupportedEventUids: resources.unsupportedEvents.map(({ uid }) => uid),
      },
    };
  };

  return { fetchEvents };
};

export { createCalDAVSourceFetcher, isCalDAVEventInSyncWindow };
export type { CalDAVSourceFetcherConfig, CalDAVSourceFetcher };
