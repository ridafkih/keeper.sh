import useSWRInfinite from "swr/infinite";

const DAYS_PER_PAGE = 7;
const FIRST_PAGE_SIZE = 1;
const HOURS_START_OF_DAY = 0;
const MINUTES_START = 0;
const SECONDS_START = 0;
const MILLISECONDS_START = 0;
const HOURS_END_OF_DAY = 23;
const MINUTES_END = 59;
const SECONDS_END = 59;
const MILLISECONDS_END = 999;

interface ApiEvent {
  id: string;
  startTime: string;
  endTime: string;
  calendarId: string;
  sourceName: string;
  sourceUrl: string;
}

interface CalendarEvent {
  id: string;
  startTime: Date;
  endTime: Date;
  calendarId: string;
  sourceName: string;
  sourceUrl: string;
}

const fetchEvents = async (url: string): Promise<CalendarEvent[]> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to fetch events");
  }

  const data: ApiEvent[] = await response.json();
  return data.map((event) => ({
    calendarId: event.calendarId,
    endTime: new Date(event.endTime),
    id: event.id,
    sourceName: event.sourceName,
    sourceUrl: event.sourceUrl,
    startTime: new Date(event.startTime),
  }));
};

interface UseEventsOptions {
  startDate?: Date;
}

interface UseEventsResult {
  events: CalendarEvent[];
  isLoading: boolean;
  isLoadingMore: boolean;
  isValidating: boolean;
  loadMore: () => void;
  size: number;
}

const setDateToStartOfDay = (date: Date): void => {
  date.setHours(HOURS_START_OF_DAY, MINUTES_START, SECONDS_START, MILLISECONDS_START);
};

const setDateToEndOfDay = (date: Date): void => {
  date.setHours(HOURS_END_OF_DAY, MINUTES_END, SECONDS_END, MILLISECONDS_END);
};

const buildEventsUrl = (from: Date, to: Date): string => {
  const url = new URL("/api/events", globalThis.location.origin);
  url.searchParams.set("from", from.toISOString());
  url.searchParams.set("to", to.toISOString());
  return url.toString();
};

const getKey = (pageIndex: number, startDate?: Date): string => {
  const baseDate = startDate ?? new Date();
  setDateToStartOfDay(baseDate);

  const from = new Date(baseDate);
  from.setDate(from.getDate() + pageIndex * DAYS_PER_PAGE);
  setDateToStartOfDay(from);

  const to = new Date(from);
  to.setDate(to.getDate() + DAYS_PER_PAGE - FIRST_PAGE_SIZE);
  setDateToEndOfDay(to);

  return buildEventsUrl(from, to);
};

const isPageLoading = (
  data: CalendarEvent[][] | undefined,
  size: number,
): boolean => {
  if (!data) {
    return false;
  }
  return data[size - FIRST_PAGE_SIZE] === undefined;
};

const useEvents = ({ startDate }: UseEventsOptions = {}): UseEventsResult => {
  const { data, size, setSize, isLoading, isValidating } = useSWRInfinite(
    (pageIndex) => getKey(pageIndex, startDate),
    fetchEvents,
    {
      revalidateFirstPage: false,
      suspense: true,
    },
  );

  const allEvents = data?.flat() ?? [];
  const events = [...new Map(allEvents.map((event) => [event.id, event])).values()];
  const isLoadingMore = isLoading || (size > FIRST_PAGE_SIZE && isPageLoading(data, size));

  const loadMore = (): void => {
    void setSize(size + FIRST_PAGE_SIZE);
  };

  return {
    events,
    isLoading,
    isLoadingMore,
    isValidating,
    loadMore,
    size,
  };
};

export { useEvents };
export type { CalendarEvent };
