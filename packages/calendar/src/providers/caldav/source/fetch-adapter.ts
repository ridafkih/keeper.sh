import type { SourceEvent } from "../../../core/types";
import type { SourceIngestionPlan, SyncWindow } from "../../../core/sync/sync-range";
import type { FetchEventsResult } from "../../../core/sync-engine/ingest";
import type { SafeFetchOptions } from "../../../utils/safe-fetch";
import { isKeeperEvent } from "../../../core/events/identity";
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

/*
 * Recurring masters are kept regardless of their own start/end: the CalDAV
 * time-range filter already returned their in-window occurrences. Non-recurring
 * events use the same overlap test the rest of the pipeline uses, so a boundary
 * event is treated identically wherever the window is applied.
 */
const isCalDAVEventInSyncWindow = (
  event: { endTime: Date; recurrenceRule?: unknown; startTime: Date },
  syncWindow: SyncWindow,
): boolean => Boolean(event.recurrenceRule)
  || event.endTime > syncWindow.timeMin && event.startTime < syncWindow.timeMax;

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

    const events: SourceEvent[] = [];
    /*
     * An empty body is an unread resource, not an absent one; it must reach the
     * parser to be counted as skipped.
     */
    const resources = parseICalCalendarsToRemoteEvents(objects.map(({ data }) => data ?? ""));

    let selfAuthoredEventCount = 0;
    let outsideSyncWindowCount = 0;

    for (const parsed of resources.events) {
      if (isKeeperEvent(parsed.uid)) {
        selfAuthoredEventCount += 1;
        continue;
      }
      if (!isCalDAVEventInSyncWindow(parsed, syncWindow)) {
        outsideSyncWindowCount += 1;
        continue;
      }

      events.push({
        availability: parsed.availability,
        description: parsed.description,
        endTime: parsed.endTime,
        exceptionDates: parsed.exceptionDates,
        recurrenceId: parsed.recurrenceId,
        isAllDay: parsed.isAllDay,
        location: parsed.location,
        recurrenceDuration: parsed.recurrenceDuration,
        recurrenceRule: parsed.recurrenceRule,
        startTime: parsed.startTime,
        startTimeZone: parsed.startTimeZone,
        title: parsed.title,
        uid: parsed.uid,
      });
    }

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
