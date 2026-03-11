import type {
  FetchEventsOptions,
  FetchEventsResult,
  GoogleCalendarEvent,
  GoogleEventsListResponse,
  EventTimeSlot,
} from "../types";
import {
  GOOGLE_CALENDAR_EVENTS_URL,
  GOOGLE_CALENDAR_MAX_RESULTS,
  GONE_STATUS,
} from "../../shared/api";
import { isSimpleAuthError } from "../../shared/errors";
import { parseEventDateTime } from "../../shared/date-time";
import { googleEventListSchema } from "@keeper.sh/data-schemas";
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

interface FetchCalendarNameOptions {
  accessToken: string;
  calendarId: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseCalendarName = (value: unknown): string | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.summary !== "string") {
    return null;
  }

  const normalizedName = value.summary.trim();
  if (normalizedName.length === 0) {
    return null;
  }

  return normalizedName;
};

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

  const responseBody = await response.json();
  const data = googleEventListSchema.assert(responseBody);
  return { data, fullSyncRequired: false };
};

const fetchCalendarEvents = async (options: FetchEventsOptions): Promise<FetchEventsResult> => {
  const {
    accessToken,
    calendarId,
    syncToken,
    timeMin,
    timeMax,
    maxResults = GOOGLE_CALENDAR_MAX_RESULTS,
  } = options;

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

  for (const event of result.data.items ?? []) {
    if (event.status === "cancelled") {
      const uid = event.iCalUID ?? event.id;
      if (uid) {
        cancelledEventUids.push(uid);
      }
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

    for (const event of result.data.items ?? []) {
      if (event.status === "cancelled") {
        const uid = event.iCalUID ?? event.id;
        if (uid) {
          cancelledEventUids.push(uid);
        }
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

const fetchCalendarName = async (options: FetchCalendarNameOptions): Promise<string | null> => {
  const url = `${GOOGLE_CALENDAR_EVENTS_URL}/${encodeURIComponent(options.calendarId)}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
    },
  });

  if (!response.ok) {
    const authRequired = isSimpleAuthError(response.status);
    throw new EventsFetchError(
      `Failed to fetch calendar metadata: ${response.status}`,
      response.status,
      authRequired,
    );
  }

  const responseBody = await response.json();
  return parseCalendarName(responseBody);
};

const resolveGoogleAvailability = (
  event: Pick<GoogleCalendarEvent, "eventType" | "transparency">,
): EventTimeSlot["availability"] => {
  if (event.eventType === "workingLocation") {
    return "workingElsewhere";
  }

  if (event.transparency === "transparent") {
    return "free";
  }

  if (event.eventType === "outOfOffice") {
    return "oof";
  }

  return "busy";
};

const resolveGoogleLocation = (
  event: Pick<GoogleCalendarEvent, "location" | "workingLocationProperties">,
): string | undefined => {
  if (event.location?.trim()) {
    return event.location;
  }

  const customLocationLabel = event.workingLocationProperties?.customLocation?.label?.trim();
  if (customLocationLabel) {
    return customLocationLabel;
  }

  return event.workingLocationProperties?.officeLocation?.label?.trim();
};

const isAllDayGoogleEvent = (
  event: Pick<GoogleCalendarEvent, "start" | "end">,
): boolean => Boolean(event.start?.date || event.end?.date);

const resolveSourceEventType = (
  eventType: GoogleCalendarEvent["eventType"],
): EventTimeSlot["sourceEventType"] => {
  if (eventType === "focusTime") {
    return "focusTime";
  }
  if (eventType === "outOfOffice") {
    return "outOfOffice";
  }
  if (eventType === "workingLocation") {
    return "workingLocation";
  }
  return "default";
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
      availability: resolveGoogleAvailability(event),
      description: event.description,
      endTime: parseEventDateTime(event.end),
      isAllDay: isAllDayGoogleEvent(event),
      location: resolveGoogleLocation(event),
      sourceEventType: resolveSourceEventType(event.eventType),
      startTime: parseEventDateTime(event.start),
      startTimeZone: event.start.timeZone ?? event.end.timeZone,
      title: event.summary,
      uid: event.iCalUID,
    });
  }

  return result;
};

export { fetchCalendarEvents, fetchCalendarName, parseGoogleEvents, EventsFetchError };
