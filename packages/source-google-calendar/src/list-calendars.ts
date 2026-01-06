import type { GoogleCalendarListEntry, GoogleCalendarListResponse } from "./types";

const GOOGLE_CALENDAR_LIST_URL = "https://www.googleapis.com/calendar/v3/users/me/calendarList";

class CalendarListError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly authRequired = false,
  ) {
    super(message);
    this.name = "CalendarListError";
  }
}

const fetchCalendarPage = async (
  accessToken: string,
  pageToken?: string,
): Promise<GoogleCalendarListResponse> => {
  const url = new URL(GOOGLE_CALENDAR_LIST_URL);
  url.searchParams.set("minAccessRole", "reader");
  if (pageToken) {
    url.searchParams.set("pageToken", pageToken);
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const authRequired = response.status === 401 || response.status === 403;
    throw new CalendarListError(
      `Failed to list calendars: ${response.status}`,
      response.status,
      authRequired,
    );
  }

  return response.json() as Promise<GoogleCalendarListResponse>;
};

const listUserCalendars = async (accessToken: string): Promise<GoogleCalendarListEntry[]> => {
  const calendars: GoogleCalendarListEntry[] = [];
  let response = await fetchCalendarPage(accessToken);
  calendars.push(...response.items);

  while (response.nextPageToken) {
    response = await fetchCalendarPage(accessToken, response.nextPageToken);
    calendars.push(...response.items);
  }

  return calendars;
};

export { listUserCalendars, CalendarListError };
