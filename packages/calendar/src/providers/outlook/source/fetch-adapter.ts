import type { FetchEventsResult } from "../../../core/sync-engine/ingest";
import { encodeStoredSyncToken, resolveSyncTokenForWindow } from "../../../core/oauth/sync-token";
import { getOAuthSyncWindow, OAUTH_SYNC_WINDOW_VERSION } from "../../../core/oauth/sync-window";
import { filterSourceEventsToSyncWindow } from "../../../core/source/sync-diagnostics";
import { fetchCalendarEvents, parseOutlookEvents } from "./utils/fetch-events";

const YEARS_UNTIL_FUTURE = 2;
const OUTLOOK_SYNC_TOKEN_VERSION = OAUTH_SYNC_WINDOW_VERSION + 1;

interface OutlookSourceFetcherConfig {
  accessToken: string;
  externalCalendarId: string;
  syncToken: string | null;
}

interface OutlookSourceFetcher {
  fetchEvents: () => Promise<FetchEventsResult>;
}

const createOutlookSourceFetcher = (config: OutlookSourceFetcherConfig): OutlookSourceFetcher => {
  const fetchEvents = async (): Promise<FetchEventsResult> => {
    const fetchOptions: Parameters<typeof fetchCalendarEvents>[0] = {
      accessToken: config.accessToken,
      calendarId: config.externalCalendarId,
    };
    const syncWindow = getOAuthSyncWindow(YEARS_UNTIL_FUTURE);

    const syncTokenResolution = resolveSyncTokenForWindow(
      config.syncToken,
      OUTLOOK_SYNC_TOKEN_VERSION,
    );

    if (syncTokenResolution.syncToken === null) {
      fetchOptions.timeMin = syncWindow.timeMin;
      fetchOptions.timeMax = syncWindow.timeMax;
    } else {
      fetchOptions.deltaLink = syncTokenResolution.syncToken;
    }

    const result = await fetchCalendarEvents(fetchOptions);

    if (result.fullSyncRequired) {
      return { events: [], fullSyncRequired: true };
    }

    const parsedEvents = parseOutlookEvents(result.events);
    const { events } = filterSourceEventsToSyncWindow(parsedEvents, syncWindow);

    const fetchResult: FetchEventsResult = {
      events,
      ...(result.isDeltaSync && {
        changedEventIds: parsedEvents.flatMap((event) => event.sourceEventId ?? []),
      }),
      cancelledEventIds: result.cancelledEventIds,
      isDeltaSync: result.isDeltaSync,
    };
    if (result.nextDeltaLink) {
      fetchResult.nextSyncToken = encodeStoredSyncToken(
        result.nextDeltaLink,
        OUTLOOK_SYNC_TOKEN_VERSION,
      );
    }

    return fetchResult;
  };

  return { fetchEvents };
};

export { createOutlookSourceFetcher };
export type { OutlookSourceFetcherConfig, OutlookSourceFetcher };
