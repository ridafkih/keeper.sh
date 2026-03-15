import type { FetchEventsResult } from "../../../core/sync-engine/ingest";
import { resolveSyncTokenForWindow } from "../../../core/oauth/sync-token";
import { getOAuthSyncWindow, OAUTH_SYNC_WINDOW_VERSION } from "../../../core/oauth/sync-window";
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

    const syncTokenResolution = resolveSyncTokenForWindow(
      config.syncToken,
      OUTLOOK_SYNC_TOKEN_VERSION,
    );

    if (syncTokenResolution.syncToken === null) {
      const syncWindow = getOAuthSyncWindow(YEARS_UNTIL_FUTURE);
      fetchOptions.timeMin = syncWindow.timeMin;
      fetchOptions.timeMax = syncWindow.timeMax;
    } else {
      fetchOptions.deltaLink = syncTokenResolution.syncToken;
    }

    const result = await fetchCalendarEvents(fetchOptions);

    if (result.fullSyncRequired) {
      return { events: [], fullSyncRequired: true };
    }

    const events = parseOutlookEvents(result.events);

    return {
      events,
      nextSyncToken: result.nextDeltaLink,
      cancelledEventUids: result.cancelledEventUids,
      isDeltaSync: result.isDeltaSync,
    };
  };

  return { fetchEvents };
};

export { createOutlookSourceFetcher };
export type { OutlookSourceFetcherConfig, OutlookSourceFetcher };
