import useSWR, { type SWRResponse } from "swr";

interface CalendarSource {
  id: string;
  name: string;
  url: string;
  createdAt: string;
}

const fetchSources = async (): Promise<CalendarSource[]> => {
  const response = await fetch("/api/ics");
  if (!response.ok) {
    throw new Error("Failed to fetch sources");
  }
  return response.json();
};

const useSources = (): SWRResponse<CalendarSource[]> => useSWR("calendar-sources", fetchSources);

export { useSources };
export type { CalendarSource };
