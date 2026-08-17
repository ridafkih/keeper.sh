import {
  googleCalendarListEntrySchema,
  googleCalendarListResponseSchema,
} from "@keeper.sh/data-schemas";
import type { GoogleCalendarListEntry } from "../types";
import { GOOGLE_CALENDAR_LIST_URL } from "../../shared/api";
import { isSimpleAuthError } from "../../shared/errors";
import { fetchWithTimeout } from "../../../../core/utils/fetch-with-timeout";
import { PROVIDER_INGEST_REQUEST_TIMEOUT_MS } from "@keeper.sh/constants";

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

const parseCalendarEntry = (value: unknown): GoogleCalendarListEntry | null => {
  if (!googleCalendarListEntrySchema.allows(value)) {
    return null;
  }
  const entry = googleCalendarListEntrySchema.assert(value);
  // Google omits the display name on some calendars, and the ID is the only stable label left.
  return { ...entry, summary: entry.summary ?? entry.id };
};

interface CalendarListPage {
  items: GoogleCalendarListEntry[];
  invalidEntryCount: number;
  nextPageToken?: string;
}

const fetchCalendarPage = async (
  accessToken: string,
  signal: AbortSignal | undefined,
  pageToken?: string,
): Promise<CalendarListPage> => {
  const url = new URL(GOOGLE_CALENDAR_LIST_URL);
  url.searchParams.set("minAccessRole", "reader");
  if (pageToken) {
    url.searchParams.set("pageToken", pageToken);
  }

  const response = await fetchWithTimeout(
    url.toString(),
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    PROVIDER_INGEST_REQUEST_TIMEOUT_MS,
    signal,
  );

  if (!response.ok) {
    const authRequired = isSimpleAuthError(response.status);
    throw new CalendarListError(
      `Failed to list calendars: ${response.status}`,
      response.status,
      authRequired,
    );
  }

  const responseBody = await response.json();
  const page = googleCalendarListResponseSchema.assert(responseBody);

  const items: GoogleCalendarListEntry[] = [];
  let invalidEntryCount = 0;
  for (const item of page.items ?? []) {
    const entry = parseCalendarEntry(item);
    if (entry) {
      items.push(entry);
      continue;
    }
    invalidEntryCount += 1;
  }

  const parsedPage: CalendarListPage = { invalidEntryCount, items };
  if (page.nextPageToken) {
    parsedPage.nextPageToken = page.nextPageToken;
  }
  return parsedPage;
};

interface ListUserCalendarsOptions {
  onInvalidEntries?: (count: number) => void;
  signal?: AbortSignal;
}

const listUserCalendars = async (
  accessToken: string,
  options?: ListUserCalendarsOptions,
): Promise<GoogleCalendarListEntry[]> => {
  const signal = options?.signal;
  const calendars: GoogleCalendarListEntry[] = [];
  let invalidEntryCount = 0;

  let response = await fetchCalendarPage(accessToken, signal);
  calendars.push(...response.items);
  invalidEntryCount += response.invalidEntryCount;

  while (response.nextPageToken) {
    signal?.throwIfAborted();
    response = await fetchCalendarPage(accessToken, signal, response.nextPageToken);
    calendars.push(...response.items);
    invalidEntryCount += response.invalidEntryCount;
  }

  if (invalidEntryCount > 0) {
    options?.onInvalidEntries?.(invalidEntryCount);
  }

  return calendars;
};

export { listUserCalendars, CalendarListError };
export type { ListUserCalendarsOptions };
