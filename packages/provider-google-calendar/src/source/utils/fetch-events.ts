import type {
  FetchEventsOptions,
  FetchEventsResult,
  GoogleCalendarEvent,
  GoogleEventsListResponse,
  EventTimeSlot,
} from "../types";
import { GOOGLE_CALENDAR_EVENTS_URL, GOOGLE_CALENDAR_MAX_RESULTS, GONE_STATUS } from "../../shared/api";
import { isSimpleAuthError } from "../../shared/errors";
import { parseEventDateTime } from "../../shared/date-time";
import { isKeeperEvent } from "@keeper.sh/provider-core";

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
    const authRequired = isSimpleAuthError(response.status);
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
  const { accessToken, calendarId, syncToken, timeMin, timeMax, maxResults = GOOGLE_CALENDAR_MAX_RESULTS } = options;

  const baseUrl = `${GOOGLE_CALENDAR_EVENTS_URL}/${encodeURIComponent(calendarId)}/events`;
  const events: GoogleCalendarEvent[] = [];
  const cancelledEventUids: string[] = [];
  const isDeltaSync = Boolean(syncToken);

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
    if (event.status === "cancelled") {
      const uid = event.iCalUID ?? event.id;
      cancelledEventUids.push(uid);
    } else {
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
      if (event.status === "cancelled") {
        const uid = event.iCalUID ?? event.id;
        cancelledEventUids.push(uid);
      } else {
        events.push(event);
      }
    }

    if (result.data.nextSyncToken) {
      lastSyncToken = result.data.nextSyncToken;
    }
  }

  const fetchResult: FetchEventsResult = {
    events,
    fullSyncRequired: false,
    isDeltaSync,
    nextSyncToken: lastSyncToken,
  };

  if (isDeltaSync) {
    fetchResult.cancelledEventUids = cancelledEventUids;
  }

  return fetchResult;
};

const parseGoogleEvents = (events: GoogleCalendarEvent[]): EventTimeSlot[] => {
  const result: EventTimeSlot[] = [];

  for (const event of events) {
    if (!event.start || !event.end || !event.iCalUID) {
      continue;
    }
    if (isKeeperEvent(event.iCalUID)) {
      continue;
    }
    result.push({
      endTime: parseEventDateTime(event.end),
      startTime: parseEventDateTime(event.start),
      uid: event.iCalUID,
    });
  }

  return result;
};

export { fetchCalendarEvents, parseGoogleEvents, EventsFetchError };
