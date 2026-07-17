import type {
  FetchEventsOptions,
  FetchEventsResult,
  OutlookCalendarEvent,
  OutlookEventsListResponse,
  EventTimeSlot,
} from "../types";
import type { MicrosoftApiError } from "../../types";
import { MICROSOFT_GRAPH_API, GONE_STATUS } from "../../shared/api";
import { isAuthError, isSimpleAuthError } from "../../shared/errors";
import { parseEventDateTime } from "../../shared/date-time";
import { microsoftApiErrorSchema, outlookEventListSchema } from "@keeper.sh/data-schemas";
import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import { isKeeperEvent } from "../../../../core/events/identity";
import { normalizeTimezone } from "../../../../ics/utils/normalize-timezone";
import { buildTimeoutSignal } from "../../../../core/utils/fetch-with-timeout";

class EventsFetchError extends Error {
  public readonly status: number;
  public readonly authRequired: boolean;
  public readonly apiError: MicrosoftApiError;

  constructor(
    message: string,
    status: number,
    authRequired = false,
    apiError: MicrosoftApiError = {},
  ) {
    super(message);
    this.name = "EventsFetchError";
    this.status = status;
    this.authRequired = authRequired;
    this.apiError = apiError;
  }
}

const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_PAGE_SIZE = 50;
const SERIES_MASTER_TYPE = "seriesMaster";
const INSTANCES_SELECT = [
  "id",
  "iCalUId",
  "subject",
  "body",
  "location",
  "start",
  "end",
  "isAllDay",
  "isCancelled",
  "showAs",
  "categories",
  "createdDateTime",
  "lastModifiedDateTime",
  "seriesMasterId",
  "type",
].join(",");

const isRequestTimeoutError = (error: unknown): boolean =>
  error instanceof Error
  && (error.name === "AbortError" || error.name === "TimeoutError");

interface PageFetchOptions {
  accessToken: string;
  calendarId: string;
  deltaLink?: string;
  timeMin?: Date;
  timeMax?: Date;
  nextLink?: string;
  signal?: AbortSignal;
}

interface PageFetchResult {
  data: OutlookEventsListResponse;
  fullSyncRequired: false;
}

interface FullSyncRequiredResult {
  fullSyncRequired: true;
}

const getOutlookRevisionTime = (event: OutlookCalendarEvent): number | null => {
  const value = event.lastModifiedDateTime ?? event.createdDateTime;
  if (!value) {
    return null;
  }
  const revisionTime = new Date(value).getTime();
  if (Number.isNaN(revisionTime)) {
    return null;
  }
  return revisionTime;
};

const shouldReplaceOutlookRevision = (
  current: OutlookCalendarEvent,
  candidate: OutlookCalendarEvent,
): boolean => {
  const currentTime = getOutlookRevisionTime(current);
  const candidateTime = getOutlookRevisionTime(candidate);
  if (currentTime !== null && candidateTime !== null && currentTime !== candidateTime) {
    return candidateTime > currentTime;
  }
  return true;
};

interface FetchCalendarNameOptions {
  accessToken: string;
  calendarId: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseMicrosoftApiErrorFromText = (text: string): MicrosoftApiError => {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!microsoftApiErrorSchema.allows(parsed)) {
      return {};
    }

    const { error } = microsoftApiErrorSchema.assert(parsed);
    return error ?? {};
  } catch {
    return {};
  }
};

const parseCalendarName = (value: unknown): string | null => {
  if (!isRecord(value) || typeof value.name !== "string") {
    return null;
  }

  const normalizedName = value.name.trim();
  if (normalizedName.length === 0) {
    return null;
  }

  return normalizedName;
};

const buildInitialUrl = (calendarId: string, timeMin: Date, timeMax: Date): URL => {
  const encodedCalendarId = encodeURIComponent(calendarId);
  const url = new URL(
    `${MICROSOFT_GRAPH_API}/me/calendars/${encodedCalendarId}/calendarView/delta`,
  );

  url.searchParams.set("startDateTime", timeMin.toISOString());
  url.searchParams.set("endDateTime", timeMax.toISOString());
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
  const timeout = buildTimeoutSignal(REQUEST_TIMEOUT_MS, options.signal);

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: `odata.maxpagesize=${DEFAULT_PAGE_SIZE}, outlook.timezone="UTC", outlook.body-content-type="text"`,
    },
    signal: timeout.signal,
  }).catch((error) => {
    if (timeout.isTimeout() || isRequestTimeoutError(error) && !options.signal?.aborted) {
      throw new EventsFetchError(
        `Failed to fetch events: timeout after ${REQUEST_TIMEOUT_MS}ms`,
        408,
        false,
      );
    }

    throw error;
  });

  if (response.status === GONE_STATUS) {
    return { fullSyncRequired: true };
  }

  if (!response.ok) {
    const responseText = await response.text();
    const apiError = parseMicrosoftApiErrorFromText(responseText);
    const authRequired = isAuthError(response.status, apiError);

    throw new EventsFetchError(
      `Failed to fetch events: ${response.status}: ${responseText}`,
      response.status,
      authRequired,
      apiError,
    );
  }

  const responseBody = await response.json();
  const data = outlookEventListSchema.assert(responseBody);
  return { data, fullSyncRequired: false };
};

const fetchSeriesMasterInstances = async (
  accessToken: string,
  calendarId: string,
  masterId: string,
  timeMin: Date,
  timeMax: Date,
  signal?: AbortSignal,
): Promise<OutlookCalendarEvent[]> => {
  const calendarPath = encodeURIComponent(calendarId);
  const masterPath = encodeURIComponent(masterId);
  const initialUrl = new URL(
    `${MICROSOFT_GRAPH_API}/me/calendars/${calendarPath}/events/${masterPath}/instances`,
  );
  initialUrl.searchParams.set("startDateTime", timeMin.toISOString());
  initialUrl.searchParams.set("endDateTime", timeMax.toISOString());
  initialUrl.searchParams.set("$select", INSTANCES_SELECT);

  const instances: OutlookCalendarEvent[] = [];
  let nextLink: string | undefined = initialUrl.toString();
  while (nextLink) {
    const pageResult = await fetchEventsPage({
      accessToken,
      calendarId,
      nextLink,
      signal,
    });
    if (pageResult.fullSyncRequired) {
      throw new EventsFetchError(
        `Failed to expand Outlook series master ${masterId}: event instances are gone`,
        GONE_STATUS,
      );
    }
    instances.push(...pageResult.data.value ?? []);
    nextLink = pageResult.data["@odata.nextLink"];
  }
  return instances;
};

const expandSeriesMasters = async (
  accessToken: string,
  calendarId: string,
  events: OutlookCalendarEvent[],
  timeMin: Date,
  timeMax: Date,
  signal?: AbortSignal,
): Promise<OutlookCalendarEvent[]> => {
  const expanded: OutlookCalendarEvent[] = [];
  for (const event of events) {
    if (event.type !== SERIES_MASTER_TYPE || !event.id) {
      expanded.push(event);
      continue;
    }
    expanded.push(...await fetchSeriesMasterInstances(
      accessToken,
      calendarId,
      event.id,
      timeMin,
      timeMax,
      signal,
    ));
  }
  return expanded;
};

const deduplicateOutlookEvents = (events: OutlookCalendarEvent[]): OutlookCalendarEvent[] => {
  const eventsById = new Map<string, OutlookCalendarEvent>();
  const eventsWithoutId: OutlookCalendarEvent[] = [];
  for (const event of events) {
    if (!event.id) {
      eventsWithoutId.push(event);
      continue;
    }
    const current = eventsById.get(event.id);
    if (!current || shouldReplaceOutlookRevision(current, event)) {
      eventsById.set(event.id, event);
    }
  }
  return [...eventsWithoutId, ...eventsById.values()];
};

const fetchCalendarEvents = async (options: FetchEventsOptions): Promise<FetchEventsResult> => {
  const { accessToken, calendarId, deltaLink, timeMin, timeMax, signal } = options;

  const changedEventsById = new Map<string, OutlookCalendarEvent>();
  const changedEventsWithoutId: OutlookCalendarEvent[] = [];
  const isDeltaSync = Boolean(deltaLink);
  const collectEvents = (pageEvents: OutlookCalendarEvent[]): void => {
    for (const event of pageEvents) {
      if (event.id) {
        const current = changedEventsById.get(event.id);
        if (current && !shouldReplaceOutlookRevision(current, event)) {
          continue;
        }
        changedEventsById.set(event.id, event);
      } else if (!event["@removed"]) {
        changedEventsWithoutId.push(event);
      }
    }
  };

  const initialResult = await fetchEventsPage({
    accessToken,
    calendarId,
    deltaLink,
    timeMax,
    timeMin,
    signal,
  });

  if (initialResult.fullSyncRequired) {
    return { events: [], fullSyncRequired: true };
  }

  collectEvents(initialResult.data.value ?? []);

  let lastDeltaLink = initialResult.data["@odata.deltaLink"];
  let nextLink = initialResult.data["@odata.nextLink"];

  while (nextLink) {
    const pageResult = await fetchEventsPage({
      accessToken,
      calendarId,
      nextLink,
      timeMax,
      timeMin,
      signal,
    });

    if (pageResult.fullSyncRequired) {
      return { events: [], fullSyncRequired: true };
    }

    collectEvents(pageResult.data.value ?? []);

    if (pageResult.data["@odata.deltaLink"]) {
      lastDeltaLink = pageResult.data["@odata.deltaLink"];
    }
    nextLink = pageResult.data["@odata.nextLink"];
  }

  let latestChangedEvents = [
    ...changedEventsWithoutId,
    ...changedEventsById.values(),
  ];
  if (isDeltaSync && latestChangedEvents.some((event) => event.type === SERIES_MASTER_TYPE)) {
    return { events: [], fullSyncRequired: true };
  }
  if (isDeltaSync && latestChangedEvents.some((event) =>
    event["@removed"] && !event.type
  )) {
    /*
     * Graph's deletion tombstones can omit the deleted event type.
     * A sparse ID may identify a series master while local state contains only expanded instances.
     * Advancing the delta token could therefore strand every occurrence of that series.
     */
    return { events: [], fullSyncRequired: true };
  }
  if (timeMin && timeMax) {
    latestChangedEvents = deduplicateOutlookEvents(await expandSeriesMasters(
      accessToken,
      calendarId,
      latestChangedEvents,
      timeMin,
      timeMax,
      signal,
    ));
  }
  const result: FetchEventsResult = {
    events: latestChangedEvents.filter((event) => !event["@removed"] && !event.isCancelled),
    fullSyncRequired: false,
    isDeltaSync,
    nextDeltaLink: lastDeltaLink,
  };

  if (isDeltaSync) {
    result.changedEventIds = latestChangedEvents.flatMap((event) => {
      if (!event.id) {
        return [];
      }
      return [event.id];
    });
    result.cancelledEventIds = latestChangedEvents.flatMap((event) => {
      if ((event["@removed"] || event.isCancelled) && event.id) {
        return [event.id];
      }
      return [];
    });
  }

  return result;
};

const fetchCalendarName = async (options: FetchCalendarNameOptions): Promise<string | null> => {
  const encodedCalendarId = encodeURIComponent(options.calendarId);
  const url = `${MICROSOFT_GRAPH_API}/me/calendars/${encodedCalendarId}?$select=name`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch((error) => {
    if (isRequestTimeoutError(error)) {
      throw new EventsFetchError(
        `Failed to fetch calendar metadata: timeout after ${REQUEST_TIMEOUT_MS}ms`,
        408,
        false,
      );
    }

    throw error;
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

const parseAvailability = (value: string | undefined): EventTimeSlot["availability"] | null => {
  if (value === "free") {
    return "free";
  }

  if (value === "oof") {
    return "oof";
  }

  if (value === "workingElsewhere") {
    return "workingElsewhere";
  }

  if (value === "busy" || value === "tentative") {
    return "busy";
  }

  return null;
};

const parseOutlookEvents = (events: OutlookCalendarEvent[]): EventTimeSlot[] => {
  const result: EventTimeSlot[] = [];

  for (const event of events) {
    if (
      !event.start?.dateTime
      || !event.start.timeZone
      || !event.end?.dateTime
      || !event.end.timeZone
      || !event.iCalUId
    ) {
      continue;
    }
    if (isKeeperEvent(event.iCalUId)) {
      continue;
    }
    if (event.categories?.includes(KEEPER_CATEGORY)) {
      continue;
    }

    const start = {
      dateTime: event.start.dateTime,
      timeZone: event.start.timeZone,
    };

    const end = {
      dateTime: event.end.dateTime,
      timeZone: event.end.timeZone,
    };

    const availability = parseAvailability(event.showAs);

    result.push({
      ...availability && { availability },
      description: event.body?.content,
      endTime: parseEventDateTime(end),
      isAllDay: event.isAllDay ?? false,
      location: event.location?.displayName,
      sourceEventId: event.id,
      startTime: parseEventDateTime(start),
      startTimeZone: normalizeTimezone(start.timeZone),
      title: event.subject,
      uid: event.iCalUId,
    });
  }

  return result;
};

export { fetchCalendarEvents, fetchCalendarName, parseOutlookEvents, EventsFetchError };
