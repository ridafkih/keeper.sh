import type { FetchEventsResult } from "../../../core/sync-engine/ingest";
import type { RedisRateLimiter } from "../../../core/utils/redis-rate-limiter";
import { encodeStoredSyncToken, resolveSyncTokenForWindow } from "../../../core/oauth/sync-token";
import { getOAuthSyncTokenVersion, getOAuthSyncWindow } from "../../../core/oauth/sync-window";
import { filterSourceEventsToSyncWindow } from "../../../core/source/sync-diagnostics";
import { fetchCalendarEvents, parseGoogleEvents } from "./utils/fetch-events";

const YEARS_UNTIL_FUTURE = 2;

interface GoogleSourceFetcherConfig {
  accessToken: string;
  externalCalendarId: string;
  syncToken: string | null;
  rateLimiter?: RedisRateLimiter;
}

interface GoogleSourceFetcher {
  fetchEvents: () => Promise<FetchEventsResult>;
}

const createGoogleSourceFetcher = (config: GoogleSourceFetcherConfig): GoogleSourceFetcher => {
  const fetchEvents = async (): Promise<FetchEventsResult> => {
    const fetchOptions: Parameters<typeof fetchCalendarEvents>[0] = {
      accessToken: config.accessToken,
      calendarId: config.externalCalendarId,
      rateLimiter: config.rateLimiter,
    };
    const syncWindow = getOAuthSyncWindow(YEARS_UNTIL_FUTURE);
    const syncTokenVersion = getOAuthSyncTokenVersion();

    const syncTokenResolution = resolveSyncTokenForWindow(
      config.syncToken,
      syncTokenVersion,
    );

    if (syncTokenResolution.syncToken === null) {
      fetchOptions.timeMin = syncWindow.timeMin;
      fetchOptions.timeMax = syncWindow.timeMax;
    } else {
      fetchOptions.syncToken = syncTokenResolution.syncToken;
    }

    const result = await fetchCalendarEvents(fetchOptions);

    if (result.fullSyncRequired) {
      return { events: [], fullSyncRequired: true };
    }

    const parsedEvents = parseGoogleEvents(result.events);
    const { events } = filterSourceEventsToSyncWindow(parsedEvents, syncWindow);

    const fetchResult: FetchEventsResult = {
      events,
      changedEventIds: result.changedEventIds,
      cancelledEventIds: result.cancelledEventIds,
      isDeltaSync: result.isDeltaSync,
    };
    if (result.nextSyncToken) {
      fetchResult.nextSyncToken = encodeStoredSyncToken(
        result.nextSyncToken,
        syncTokenVersion,
      );
    }

    return fetchResult;
  };

  return { fetchEvents };
};

export { createGoogleSourceFetcher };
export type { GoogleSourceFetcherConfig, GoogleSourceFetcher };
