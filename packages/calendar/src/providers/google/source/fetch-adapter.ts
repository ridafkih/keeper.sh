import type { FetchEventsResult } from "../../../core/sync-engine/ingest";
import type { RedisRateLimiter } from "../../../core/utils/redis-rate-limiter";
import type { SourceIngestionPlan } from "../../../core/sync/sync-range";
import { encodeStoredSyncToken, resolveSyncTokenForWindow } from "../../../core/oauth/sync-token";
import { getOAuthSyncTokenVersion } from "../../../core/oauth/sync-window";
import { filterSourceEventsToSyncWindow } from "../../../core/source/sync-diagnostics";
import { fetchCalendarEvents, parseGoogleEvents } from "./utils/fetch-events";

interface GoogleSourceFetcherConfig {
  accessToken: string;
  calendarId: string;
  externalCalendarId: string;
  syncToken: string | null;
  rateLimiter?: RedisRateLimiter;
  signal?: AbortSignal;
  plan: SourceIngestionPlan;
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
      signal: config.signal,
    };
    const { futureRange, historicRange, window: syncWindow } = config.plan;
    const syncTokenVersion = getOAuthSyncTokenVersion(0, new Date(), config.calendarId);

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
      return { events: [], fullSyncRequired: true, syncWindow };
    }
    if (!result.nextSyncToken) {
      return { events: [], fullSyncRequired: true, syncWindow };
    }

    const parsedEvents = parseGoogleEvents(result.events);
    const { events } = filterSourceEventsToSyncWindow(parsedEvents, syncWindow);

    return {
      events,
      changedEventIds: result.changedEventIds,
      cancelledEventIds: result.cancelledEventIds,
      isDeltaSync: result.isDeltaSync,
      nextSyncToken: encodeStoredSyncToken(
        result.nextSyncToken,
        syncTokenVersion,
      ),
      syncWindow,
      ...(!result.isDeltaSync && {
        coverage: {
          futureRange,
          historicRange,
          window: syncWindow,
        },
      }),
    };
  };

  return { fetchEvents };
};

export { createGoogleSourceFetcher };
export type { GoogleSourceFetcherConfig, GoogleSourceFetcher };
