import type { OutlookCalendarListEntry, OutlookCalendarListResponse } from "../types";
import { MICROSOFT_GRAPH_API } from "../../shared/api";
import { isSimpleAuthError } from "../../shared/errors";

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
  nextLink?: string,
): Promise<OutlookCalendarListResponse> => {
  let url = new URL(`${MICROSOFT_GRAPH_API}/me/calendars`);
  if (nextLink) {
    url = new URL(nextLink);
  } else {
    url.searchParams.set("$select", "id,name,color,isDefaultCalendar,canEdit,owner");
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

  return response.json() as Promise<OutlookCalendarListResponse>;
};

const listUserCalendars = async (accessToken: string): Promise<OutlookCalendarListEntry[]> => {
  const calendars: OutlookCalendarListEntry[] = [];
  let response = await fetchCalendarPage(accessToken);
  calendars.push(...response.value);

  while (response["@odata.nextLink"]) {
    response = await fetchCalendarPage(accessToken, response["@odata.nextLink"]);
    calendars.push(...response.value);
  }

  return calendars;
};

export { listUserCalendars, CalendarListError };
