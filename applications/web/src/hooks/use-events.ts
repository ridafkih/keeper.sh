import useSWRInfinite from "swr/infinite";
import { fetcher } from "../lib/fetcher";
import { useStartOfToday } from "./use-start-of-today";
import type { ApiEvent } from "../types/api";

export interface CalendarEvent {
  id: string;
  startTime: Date;
  endTime: Date;
  calendarId: string;
  calendarName: string;
  calendarProvider: string;
  calendarUrl: string;
}

const DAYS_PER_PAGE = 7;

const buildEventsUrl = (from: Date, to: Date): string => {
  const url = new URL("/api/events", globalThis.location.origin);
  url.searchParams.set("from", from.toISOString());
  url.searchParams.set("to", to.toISOString());
  return url.toString();
};

const fetchEvents = async (url: string): Promise<CalendarEvent[]> => {
  const data = await fetcher<ApiEvent[]>(url);
  return data.map((event) => ({
    id: event.id,
    startTime: new Date(event.startTime),
    endTime: new Date(event.endTime),
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

const deduplicateEvents = (events: CalendarEvent[]): CalendarEvent[] => [
  ...new Map(events.map((event) => [event.id, event])).values(),
];

function resolveEvents(data: CalendarEvent[][] | undefined): CalendarEvent[] {
  if (data) return deduplicateEvents(data.flat());
  return [];
}
