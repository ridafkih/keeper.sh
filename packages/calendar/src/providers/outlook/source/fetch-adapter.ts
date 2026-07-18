import type { FetchEventsResult } from "../../../core/sync-engine/ingest";
import { encodeStoredSyncToken, resolveSyncTokenForWindow } from "../../../core/oauth/sync-token";
import { getOAuthSyncTokenVersion, getOAuthSyncWindow } from "../../../core/oauth/sync-window";
import { filterSourceEventsToSyncWindow } from "../../../core/source/sync-diagnostics";
import { fetchCalendarEvents, parseOutlookEvents } from "./utils/fetch-events";

const YEARS_UNTIL_FUTURE = 2;
const OUTLOOK_ADAPTER_VERSION = 1;

interface OutlookSourceFetcherConfig {
  accessToken: string;
  externalCalendarId: string;
  syncToken: string | null;
  signal?: AbortSignal;
}

interface OutlookSourceFetcher {
  fetchEvents: () => Promise<FetchEventsResult>;
}

const createOutlookSourceFetcher = (config: OutlookSourceFetcherConfig): OutlookSourceFetcher => {
  const fetchEvents = async (): Promise<FetchEventsResult> => {
    const fetchOptions: Parameters<typeof fetchCalendarEvents>[0] = {
      accessToken: config.accessToken,
      calendarId: config.externalCalendarId,
      signal: config.signal,
    };
    const syncWindow = getOAuthSyncWindow(YEARS_UNTIL_FUTURE);
    const syncTokenVersion = getOAuthSyncTokenVersion(OUTLOOK_ADAPTER_VERSION);

    const syncTokenResolution = resolveSyncTokenForWindow(
      config.syncToken,
      syncTokenVersion,
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
    if (!result.nextDeltaLink) {
      return { events: [], fullSyncRequired: true };
    }

    const parsedEvents = parseOutlookEvents(result.events);
    const { events } = filterSourceEventsToSyncWindow(parsedEvents, syncWindow);

    return {
      events,
      changedEventIds: result.changedEventIds,
      cancelledEventIds: result.cancelledEventIds,
      isDeltaSync: result.isDeltaSync,
      nextSyncToken: encodeStoredSyncToken(
        result.nextDeltaLink,
        syncTokenVersion,
      ),
    };
  };

  return { fetchEvents };
};

export { createOutlookSourceFetcher };
export type { OutlookSourceFetcherConfig, OutlookSourceFetcher };
