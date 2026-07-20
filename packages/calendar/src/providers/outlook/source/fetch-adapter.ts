import type { FetchEventsResult } from "../../../core/sync-engine/ingest";
import type { SyncRange } from "@keeper.sh/data-schemas";
import {
  DEFAULT_FUTURE_SYNC_RANGE,
  DEFAULT_HISTORIC_SYNC_RANGE,
  getConfigurableSyncWindow,
  type ConfigurableSyncWindow,
} from "../../../core/sync/sync-range";
import { encodeStoredSyncToken, resolveSyncTokenForWindow } from "../../../core/oauth/sync-token";
import { getOAuthSyncTokenVersion } from "../../../core/oauth/sync-window";
import { filterSourceEventsToSyncWindow } from "../../../core/source/sync-diagnostics";
import { fetchCalendarEvents, parseOutlookEvents } from "./utils/fetch-events";

const OUTLOOK_ADAPTER_VERSION = 1;

interface OutlookSourceFetcherConfig {
  accessToken: string;
  calendarId: string;
  externalCalendarId: string;
  syncToken: string | null;
  signal?: AbortSignal;
  syncWindow?: ConfigurableSyncWindow;
  historicRange?: SyncRange;
  futureRange?: SyncRange;
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
    const historicRange = config.historicRange ?? DEFAULT_HISTORIC_SYNC_RANGE;
    const futureRange = config.futureRange ?? DEFAULT_FUTURE_SYNC_RANGE;
    const syncWindow = config.syncWindow ?? getConfigurableSyncWindow(historicRange, futureRange);
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
