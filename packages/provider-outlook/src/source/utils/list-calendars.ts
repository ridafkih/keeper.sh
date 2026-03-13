import type { OutlookCalendarListEntry, OutlookCalendarListResponse } from "../types";
import { MICROSOFT_GRAPH_API } from "../../shared/api";
import { isSimpleAuthError } from "../../shared/errors";

const INVALID_RESPONSE_STATUS = 502;

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseCalendarOwner = (value: unknown): OutlookCalendarListEntry["owner"] | undefined => {
  if (!isRecord(value)) {
    return;
  }

  const owner: OutlookCalendarListEntry["owner"] = {};
  if (typeof value.name === "string") {
    owner.name = value.name;
  }
  if (typeof value.address === "string") {
    owner.address = value.address;
  }

  if (!owner.name && !owner.address) {
    return;
  }
  return owner;
};

const parseCalendarEntry = (value: unknown): OutlookCalendarListEntry | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.id !== "string" || typeof value.name !== "string") {
    return null;
  }

  const entry: OutlookCalendarListEntry = {
    id: value.id,
    name: value.name,
  };

  if (typeof value.color === "string") {
    entry.color = value.color;
  }
  if (typeof value.isDefaultCalendar === "boolean") {
    entry.isDefaultCalendar = value.isDefaultCalendar;
  }
  if (typeof value.canEdit === "boolean") {
    entry.canEdit = value.canEdit;
  }

  const owner = parseCalendarOwner(value.owner);
  if (owner) {
    entry.owner = owner;
  }

  return entry;
};

const parseCalendarListResponse = (value: unknown): OutlookCalendarListResponse | null => {
  if (!isRecord(value) || !Array.isArray(value.value)) {
    return null;
  }

  const calendars: OutlookCalendarListEntry[] = [];
  for (const calendar of value.value) {
    const parsedCalendar = parseCalendarEntry(calendar);
    if (!parsedCalendar) {
      return null;
    }
    calendars.push(parsedCalendar);
  }

  const parsedResponse: OutlookCalendarListResponse = { value: calendars };
  if (typeof value["@odata.nextLink"] === "string") {
    parsedResponse["@odata.nextLink"] = value["@odata.nextLink"];
  }
  return parsedResponse;
};

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

  const responseBody = await response.json();
  const parsedResponse = parseCalendarListResponse(responseBody);
  if (!parsedResponse) {
    throw new CalendarListError("Invalid calendar list response", INVALID_RESPONSE_STATUS);
  }
  return parsedResponse;
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
