import type { FetchEventsResult } from "../../../core/sync-engine/ingest";
import type { RedisRateLimiter } from "../../../core/utils/redis-rate-limiter";
import type { SourceIngestionPlan } from "../../../core/sync/sync-range";
import { encodeStoredSyncToken, resolveSyncTokenForWindow } from "../../../core/oauth/sync-token";
import { getOAuthSyncTokenVersion } from "../../../core/oauth/sync-window";
import { filterSourceEventsToSyncWindow } from "../../../core/source/sync-diagnostics";
import { fetchCalendarEvents, parseGoogleEventsWithDiagnostics } from "./utils/fetch-events";
import { measureSyncSegment } from "../../../core/telemetry/segments";

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

    const { events, filteredCount, parsed } = measureSyncSegment("work.transform_ms", () => {
      const diagnosed = parseGoogleEventsWithDiagnostics(result.events);
      return {
        parsed: diagnosed,
        ...filterSourceEventsToSyncWindow(diagnosed.events, syncWindow),
      };
    });

    return {
      events,
      discardedEventCounts: {
        outsideSyncWindow: filteredCount,
        unrepresentable: parsed.unrepresentableCount,
      },
      selfAuthoredEventCount: parsed.selfAuthoredCount,
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
