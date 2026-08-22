import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { fetcher } from "@/lib/fetcher";
import { useStartOfToday } from "./use-start-of-today";
import type { ApiEvent } from "@/types/api";

export interface CalendarEvent {
  id: string;
  eventStateId: string | null;
  title: string | null;
  description: string | null;
  startTime: Date;
  endTime: Date;
  /** Whole-day event: `startTime`/`endTime` are the UTC-midnight day bounds. */
  isAllDay: boolean;
  calendarId: string;
  calendarName: string;
  calendarProvider: string;
  calendarUrl: string;
}

const DAYS_PER_PAGE = 7;

/** Relative, so the key is the same string on the server and in the browser.
 * Bun defines no `globalThis.location`; SWR swallows a *key function* that
 * throws (which is how `useEvents` survived server rendering with the old
 * absolute URL), but a plain string key built eagerly would not be caught. */
const buildEventsUrl = (from: Date, to: Date): string => {
  const params = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
  });
  return `/api/events?${params.toString()}`;
};

const fetchEvents = async (url: string): Promise<CalendarEvent[]> => {
  const data = await fetcher<ApiEvent[]>(url);
  return data.map((event) => ({
    id: event.id,
    eventStateId: event.eventStateId,
    title: event.title ?? null,
    description: event.description ?? null,
    startTime: new Date(event.startTime),
    endTime: new Date(event.endTime),
    isAllDay: event.isAllDay,
    calendarId: event.calendarId,
    calendarName: event.calendarName,
    calendarProvider: event.calendarProvider,
    calendarUrl: event.calendarUrl,
  }));
};

export function useEvents() {
  const todayStart = useStartOfToday();

  const getKey = (pageIndex: number): string => {
    const from = new Date(todayStart);
    from.setDate(from.getDate() + pageIndex * DAYS_PER_PAGE);

    const to = new Date(from);
    to.setDate(to.getDate() + DAYS_PER_PAGE - 1);
    to.setHours(23, 59, 59, 999);

    return buildEventsUrl(from, to);
  };

  const { data, error, setSize, isLoading, isValidating } = useSWRInfinite(
    getKey,
    fetchEvents,
    { revalidateFirstPage: false, keepPreviousData: true },
  );

  const events = resolveEvents(data);
  const hasMore = !data || (data[data.length - 1]?.length ?? 0) > 0;

  const loadMore = () => {
    void setSize((prev) => prev + 1);
  };

  return { events, error, isLoading, isValidating, hasMore, loadMore };
}

const NO_EVENTS: CalendarEvent[] = [];

/** The API treats `to` as inclusive (see the read window in services/api).
 * Callers pass a half-open `[start, end)` so day boundaries compose, and the
 * hook steps the end back by a millisecond. */
const INCLUSIVE_END_MS = 1;

interface EventsInRange {
  events: CalendarEvent[];
  error: Error | undefined;
  isLoading: boolean;
}

/**
 * The events overlapping `[start, end)`, for a view that can look anywhere in
 * time (the calendar pane) rather than page forward from today. The previous
 * range's events stay on screen while a new one loads, so a window shift
 * never blanks the grid.
 */
export function useEventsInRange(start: Date, end: Date): EventsInRange {
  const url = buildEventsUrl(start, new Date(end.getTime() - INCLUSIVE_END_MS));
  const { data, error, isLoading } = useSWR<CalendarEvent[], Error>(url, fetchEvents, {
    keepPreviousData: true,
  });

  return { events: data ?? NO_EVENTS, error, isLoading };
}

const deduplicateEvents = (events: CalendarEvent[]): CalendarEvent[] => [
  ...new Map(events.map((event) => [event.id, event])).values(),
];

function resolveEvents(data: CalendarEvent[][] | undefined): CalendarEvent[] {
  if (data) return deduplicateEvents(data.flat());
  return [];
}
