import type { FetchEventsResult } from "../../../core/sync-engine/ingest";
import type { RedisRateLimiter } from "../../../core/utils/redis-rate-limiter";
import { resolveSyncTokenForWindow } from "../../../core/oauth/sync-token";
import { getOAuthSyncWindow, OAUTH_SYNC_WINDOW_VERSION } from "../../../core/oauth/sync-window";
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

    const syncTokenResolution = resolveSyncTokenForWindow(
      config.syncToken,
      OAUTH_SYNC_WINDOW_VERSION,
    );

    if (syncTokenResolution.syncToken === null) {
      const syncWindow = getOAuthSyncWindow(YEARS_UNTIL_FUTURE);
      fetchOptions.timeMin = syncWindow.timeMin;
      fetchOptions.timeMax = syncWindow.timeMax;
    } else {
      fetchOptions.syncToken = syncTokenResolution.syncToken;
    }

    const result = await fetchCalendarEvents(fetchOptions);

    if (result.fullSyncRequired) {
      return { events: [], fullSyncRequired: true };
    }

    const events = parseGoogleEvents(result.events);

    return {
      events,
      nextSyncToken: result.nextSyncToken,
      cancelledEventUids: result.cancelledEventUids,
      isDeltaSync: result.isDeltaSync,
    };
  };

  return { fetchEvents };
};

export { createGoogleSourceFetcher };
export type { GoogleSourceFetcherConfig, GoogleSourceFetcher };
