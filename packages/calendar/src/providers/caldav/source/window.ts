import type { ParsedCalendarEvent } from "../shared/ics";
import type { SourceEvent } from "../../../core/types";
import type { SyncWindow } from "../../../core/sync/sync-range";
import { isKeeperEvent } from "../../../core/events/identity";
import { overlapsTimeWindow } from "../../../core/events/time-range";

// Masters are kept unconditionally: the CalDAV time-range filter already returned their in-window occurrences.
const isCalDAVEventInSyncWindow = (
  event: { endTime: Date; recurrenceRule?: unknown; startTime: Date },
  syncWindow: SyncWindow,
): boolean => Boolean(event.recurrenceRule)
  || overlapsTimeWindow(event, syncWindow.timeMin, syncWindow.timeMax);

interface CalDAVSourceEventPartition {
  events: SourceEvent[];
  outsideSyncWindowCount: number;
  selfAuthoredEventCount: number;
}

const toSourceEvent = (parsed: ParsedCalendarEvent): SourceEvent => ({
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
});

const partitionCalDAVSourceEvents = (
  parsedEvents: ParsedCalendarEvent[],
  syncWindow: SyncWindow,
): CalDAVSourceEventPartition => {
  const foreignEvents = parsedEvents.filter((parsed) => !isKeeperEvent(parsed.uid));
  const inWindowEvents = foreignEvents.filter(
    (parsed) => isCalDAVEventInSyncWindow(parsed, syncWindow),
  );
  return {
    events: inWindowEvents.map((parsed) => toSourceEvent(parsed)),
    outsideSyncWindowCount: foreignEvents.length - inWindowEvents.length,
    selfAuthoredEventCount: parsedEvents.length - foreignEvents.length,
  };
};

const buildCalDAVSourceEvents = (
  parsedEvents: ParsedCalendarEvent[],
  syncWindow: SyncWindow,
): SourceEvent[] => partitionCalDAVSourceEvents(parsedEvents, syncWindow).events;

export { buildCalDAVSourceEvents, isCalDAVEventInSyncWindow, partitionCalDAVSourceEvents };
export type { CalDAVSourceEventPartition };
