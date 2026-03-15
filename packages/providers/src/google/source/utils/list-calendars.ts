import { googleCalendarListResponseSchema } from "@keeper.sh/data-schemas";
import type { GoogleCalendarListEntry, GoogleCalendarListResponse } from "../types";
import { GOOGLE_CALENDAR_LIST_URL } from "../../shared/api";
import { isSimpleAuthError } from "../../shared/errors";

class CalendarListError extends Error {
  public readonly status: number;
  public readonly authRequired: boolean;

  constructor(
    message: string,
    status: number,
    authRequired = false,
  ) {
    super(message);
    this.name = "CalendarListError";
    this.status = status;
    this.authRequired = authRequired;
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
    const authRequired = isSimpleAuthError(response.status);
    throw new CalendarListError(
      `Failed to list calendars: ${response.status}`,
      response.status,
      authRequired,
    );
  }

  const responseBody = await response.json();
  return googleCalendarListResponseSchema.assert(responseBody);
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
