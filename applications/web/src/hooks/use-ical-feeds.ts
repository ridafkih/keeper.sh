import useSWR from "swr";
import { fetcher, apiFetch } from "@/lib/fetcher";

export interface IcalFeed {
  id: string;
  userId: string;
  name: string;
  token: string;
  isDefault: boolean;
  legacyAlias: boolean;
  includeEventName: boolean;
  includeEventDescription: boolean;
  includeEventLocation: boolean;
  excludeAllDayEvents: boolean;
  excludeFocusTime: boolean;
  excludeOutOfOffice: boolean;
  customEventName: string;
  createdAt: string;
  icalUrl: string;
  legacyIcalUrl?: string;
  calendarCount?: number;
}

export interface FeedCalendarSelection {
  calendarIds: string[];
}

export const useIcalFeeds = () => {
  return useSWR<IcalFeed[]>("/api/ical/feeds", fetcher);
};

export const useIcalFeed = (feedId: string) => {
  return useSWR<IcalFeed>(`/api/ical/feeds/${feedId}`, fetcher);
};

export const useFeedCalendars = (feedId: string) => {
  return useSWR<FeedCalendarSelection>(`/api/ical/feeds/${feedId}/calendars`, fetcher);
};

export const createIcalFeed = async (name: string): Promise<IcalFeed> => {
  const response = await apiFetch("/api/ical/feeds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return response.json();
};

export const deleteIcalFeed = async (id: string): Promise<void> => {
  await apiFetch(`/api/ical/feeds/${id}`, { method: "DELETE" });
};

export const setFeedCalendars = async (
  id: string,
  calendarIds: string[],
): Promise<void> => {
  await apiFetch(`/api/ical/feeds/${id}/calendars`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ calendarIds }),
  });
};
