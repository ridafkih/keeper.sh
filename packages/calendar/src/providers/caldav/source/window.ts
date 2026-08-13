import type { ParsedCalendarEvent } from "../shared/ics";
import type { SourceEvent } from "../../../core/types";
import type { SyncWindow } from "../../../core/sync/sync-range";
import { isKeeperEvent } from "../../../core/events/identity";
import { overlapsTimeWindow } from "../../../core/events/time-range";

/*
 * Recurring masters are kept regardless of their own start/end: the CalDAV
 * time-range filter already returned their in-window occurrences. Non-recurring events
 * go through the one shared window predicate every other layer applies, so a boundary
 * event is treated identically wherever the window is applied.
 */
const isCalDAVEventInSyncWindow = (
  event: { endTime: Date; recurrenceRule?: unknown; startTime: Date },
  syncWindow: SyncWindow,
): boolean => Boolean(event.recurrenceRule)
  || overlapsTimeWindow(event, syncWindow.timeMin, syncWindow.timeMax);

/*
 * Every CalDAV ingest path — the cron fetcher and the on-demand provider alike — reads
 * the same collection and must keep the same events, so both build their source events
 * here rather than restating the window rule.
 */
const buildCalDAVSourceEvents = (
  parsedEvents: ParsedCalendarEvent[],
  syncWindow: SyncWindow,
): SourceEvent[] => parsedEvents.flatMap((parsed): SourceEvent[] => {
  if (isKeeperEvent(parsed.uid) || !isCalDAVEventInSyncWindow(parsed, syncWindow)) {
    return [];
  }
  return [{
    availability: parsed.availability,
    description: parsed.description,
    endTime: parsed.endTime,
    exceptionDates: parsed.exceptionDates,
    isAllDay: parsed.isAllDay,
    location: parsed.location,
    recurrenceDuration: parsed.recurrenceDuration,
    recurrenceId: parsed.recurrenceId,
    recurrenceRule: parsed.recurrenceRule,
    startTime: parsed.startTime,
    startTimeZone: parsed.startTimeZone,
    title: parsed.title,
    uid: parsed.uid,
  }];
});

export { buildCalDAVSourceEvents, isCalDAVEventInSyncWindow };
