import type { FetchEventsResult } from "../../../core/sync-engine/ingest";
import type { SourceIngestionPlan } from "../../../core/sync/sync-range";
import { encodeStoredSyncToken, resolveSyncTokenForWindow } from "../../../core/oauth/sync-token";
import { getOAuthSyncTokenVersion } from "../../../core/oauth/sync-window";
import { filterSourceEventsToSyncWindow } from "../../../core/source/sync-diagnostics";
import { fetchCalendarEvents, parseOutlookEventsWithDiagnostics } from "./utils/fetch-events";

const OUTLOOK_ADAPTER_VERSION = 1;

interface OutlookSourceFetcherConfig {
  accessToken: string;
  calendarId: string;
  externalCalendarId: string;
  syncToken: string | null;
  signal?: AbortSignal;
  plan: SourceIngestionPlan;
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
    const { futureRange, historicRange, window: syncWindow } = config.plan;
    const syncTokenVersion = getOAuthSyncTokenVersion(
      OUTLOOK_ADAPTER_VERSION,
      new Date(),
      config.calendarId,
    );

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
      return { events: [], fullSyncRequired: true, syncWindow };
    }
    if (!result.nextDeltaLink) {
      return { events: [], fullSyncRequired: true, syncWindow };
    }

    const parsed = parseOutlookEventsWithDiagnostics(result.events);
    const { events, filteredCount } = filterSourceEventsToSyncWindow(parsed.events, syncWindow);

    return {
      events,
      /*
       * An empty expansion was asked for over the sync window itself, so it
       * means "no occurrence in the window" like any other filtered event.
       */
      discardedEventCounts: {
        outsideSyncWindow: filteredCount + (result.unexpandedSeriesMasterCount ?? 0),
        unrepresentable: parsed.unrepresentableCount,
      },
      selfAuthoredEventCount: parsed.selfAuthoredCount,
      changedEventIds: result.changedEventIds,
      cancelledEventIds: result.cancelledEventIds,
      isDeltaSync: result.isDeltaSync,
      nextSyncToken: encodeStoredSyncToken(
        result.nextDeltaLink,
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

export { createOutlookSourceFetcher };
export type { OutlookSourceFetcherConfig, OutlookSourceFetcher };
