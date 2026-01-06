import type {
  FetchEventsOptions,
  FetchEventsResult,
  GoogleCalendarEvent,
  GoogleEventsListResponse,
  EventTimeSlot,
} from "./types";

const GOOGLE_CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars";
const DEFAULT_MAX_RESULTS = 2500;
const GONE_STATUS = 410;

class EventsFetchError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly authRequired = false,
  ) {
    super(message);
    this.name = "EventsFetchError";
  }
}

interface PageFetchOptions {
  accessToken: string;
  baseUrl: string;
  syncToken?: string;
  timeMin?: Date;
  timeMax?: Date;
  maxResults: number;
  pageToken?: string;
}

interface PageFetchResult {
  data: GoogleEventsListResponse;
  fullSyncRequired: false;
}

interface FullSyncRequiredResult {
  fullSyncRequired: true;
}

const fetchEventsPage = async (
  options: PageFetchOptions,
): Promise<PageFetchResult | FullSyncRequiredResult> => {
  const { accessToken, baseUrl, syncToken, timeMin, timeMax, maxResults, pageToken } = options;

  const url = new URL(baseUrl);
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("singleEvents", "true");

  if (syncToken) {
    url.searchParams.set("syncToken", syncToken);
  } else {
    if (timeMin) {
      url.searchParams.set("timeMin", timeMin.toISOString());
    }
    if (timeMax) {
      url.searchParams.set("timeMax", timeMax.toISOString());
    }
  }

  if (pageToken) {
    url.searchParams.set("pageToken", pageToken);
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.status === GONE_STATUS) {
    return { fullSyncRequired: true };
  }

  if (!response.ok) {
    const authRequired = response.status === 401 || response.status === 403;
    throw new EventsFetchError(
      `Failed to fetch events: ${response.status}`,
      response.status,
      authRequired,
    );
  }

  const data = (await response.json()) as GoogleEventsListResponse;
  return { data, fullSyncRequired: false };
};

const fetchCalendarEvents = async (options: FetchEventsOptions): Promise<FetchEventsResult> => {
  const { accessToken, calendarId, syncToken, timeMin, timeMax, maxResults = DEFAULT_MAX_RESULTS } = options;

  const baseUrl = `${GOOGLE_CALENDAR_EVENTS_URL}/${encodeURIComponent(calendarId)}/events`;
  const events: GoogleCalendarEvent[] = [];

  let result = await fetchEventsPage({
    accessToken,
    baseUrl,
    maxResults,
    syncToken,
    timeMax,
    timeMin,
  });

  if (result.fullSyncRequired) {
    return { events: [], fullSyncRequired: true };
  }

  for (const event of result.data.items) {
    if (event.status !== "cancelled") {
      events.push(event);
    }
  }

  let lastSyncToken = result.data.nextSyncToken;

  while (result.data.nextPageToken) {
    result = await fetchEventsPage({
      accessToken,
      baseUrl,
      maxResults,
      pageToken: result.data.nextPageToken,
      syncToken,
      timeMax,
      timeMin,
    });

    if (result.fullSyncRequired) {
      return { events: [], fullSyncRequired: true };
    }

    for (const event of result.data.items) {
      if (event.status !== "cancelled") {
        events.push(event);
      }
    }

    if (result.data.nextSyncToken) {
      lastSyncToken = result.data.nextSyncToken;
    }
  }

  return {
    events,
    fullSyncRequired: false,
    nextSyncToken: lastSyncToken,
  };
};

const parseEventDateTime = (dt: { date?: string; dateTime?: string }): Date => {
  if (dt.dateTime) {
    return new Date(dt.dateTime);
  }
  if (dt.date) {
    return new Date(dt.date);
  }
  throw new Error("Event has no date or dateTime");
};

const parseGoogleEvents = (events: GoogleCalendarEvent[]): EventTimeSlot[] =>
  events
    .filter((event) => event.start && event.end)
    .map((event) => ({
      endTime: parseEventDateTime(event.end),
      startTime: parseEventDateTime(event.start),
      uid: event.iCalUID ?? event.id,
    }));

export { fetchCalendarEvents, parseGoogleEvents, EventsFetchError };
