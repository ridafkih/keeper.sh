import type {
  FetchEventsOptions,
  FetchEventsResult,
  OutlookCalendarEvent,
  OutlookEventsListResponse,
  EventTimeSlot,
} from "../types";
import { MICROSOFT_GRAPH_API, GONE_STATUS } from "../../shared/api";
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
  calendarId: string;
  deltaLink?: string;
  timeMin?: Date;
  timeMax?: Date;
  nextLink?: string;
}

interface PageFetchResult {
  data: OutlookEventsListResponse;
  fullSyncRequired: false;
}

interface FullSyncRequiredResult {
  fullSyncRequired: true;
}

const buildInitialUrl = (calendarId: string, timeMin: Date, timeMax: Date): URL => {
  const encodedCalendarId = encodeURIComponent(calendarId);
  const url = new URL(`${MICROSOFT_GRAPH_API}/me/calendars/${encodedCalendarId}/calendarView/delta`);

  url.searchParams.set("startDateTime", timeMin.toISOString());
  url.searchParams.set("endDateTime", timeMax.toISOString());
  url.searchParams.set("$select", "id,iCalUId,subject,start,end");

  return url;
};

const getRequestUrl = (options: PageFetchOptions): URL => {
  const { calendarId, deltaLink, timeMin, timeMax, nextLink } = options;

  if (nextLink) {
    return new URL(nextLink);
  }

  if (deltaLink) {
    return new URL(deltaLink);
  }

  if (timeMin && timeMax) {
    return buildInitialUrl(calendarId, timeMin, timeMax);
  }

  throw new Error("Either deltaLink/nextLink or timeMin/timeMax is required");
};

const fetchEventsPage = async (
  options: PageFetchOptions,
): Promise<PageFetchResult | FullSyncRequiredResult> => {
  const { accessToken } = options;
  const url = getRequestUrl(options);

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

  const data = (await response.json()) as OutlookEventsListResponse;
  return { data, fullSyncRequired: false };
};

const fetchCalendarEvents = async (options: FetchEventsOptions): Promise<FetchEventsResult> => {
  const { accessToken, calendarId, deltaLink, timeMin, timeMax } = options;

  const events: OutlookCalendarEvent[] = [];
  const cancelledEventUids: string[] = [];
  const isDeltaSync = Boolean(deltaLink);

  const initialResult = await fetchEventsPage({
    accessToken,
    calendarId,
    deltaLink,
    timeMax,
    timeMin,
  });

  if (initialResult.fullSyncRequired) {
    return { events: [], fullSyncRequired: true };
  }

  for (const event of initialResult.data.value) {
    if (event["@removed"]) {
      const uid = event.iCalUId ?? event.id;
      cancelledEventUids.push(uid);
    } else {
      events.push(event);
    }
  }

  let lastDeltaLink = initialResult.data["@odata.deltaLink"];
  let nextLink = initialResult.data["@odata.nextLink"];

  while (nextLink) {
    const pageResult = await fetchEventsPage({
      accessToken,
      calendarId,
      nextLink,
      timeMax,
      timeMin,
    });

    if (pageResult.fullSyncRequired) {
      return { events: [], fullSyncRequired: true };
    }

    for (const event of pageResult.data.value) {
      if (event["@removed"]) {
        const uid = event.iCalUId ?? event.id;
        cancelledEventUids.push(uid);
      } else {
        events.push(event);
      }
    }

    if (pageResult.data["@odata.deltaLink"]) {
      lastDeltaLink = pageResult.data["@odata.deltaLink"];
    }
    nextLink = pageResult.data["@odata.nextLink"];
  }

  const result: FetchEventsResult = {
    events,
    fullSyncRequired: false,
    isDeltaSync,
    nextDeltaLink: lastDeltaLink,
  };

  if (isDeltaSync) {
    result.cancelledEventUids = cancelledEventUids;
  }

  return result;
};

const parseOutlookEvents = (events: OutlookCalendarEvent[]): EventTimeSlot[] => {
  const result: EventTimeSlot[] = [];

  for (const event of events) {
    if (!event.start || !event.end || !event.iCalUId) {
      continue;
    }
    if (isKeeperEvent(event.iCalUId)) {
      continue;
    }
    result.push({
      endTime: parseEventDateTime(event.end),
      startTime: parseEventDateTime(event.start),
      uid: event.iCalUId,
    });
  }

  return result;
};

export { fetchCalendarEvents, parseOutlookEvents, EventsFetchError };
