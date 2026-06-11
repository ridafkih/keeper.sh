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
import {
  microsoftApiErrorSchema,
  outlookEventListSchema,
  outlookEventSchema,
} from "@keeper.sh/data-schemas";
import { HTTP_STATUS, KEEPER_CATEGORY } from "@keeper.sh/constants";
import { isKeeperEvent } from "../../../../core/events/identity";

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
const EVENT_SELECT_FIELDS =
  "id,iCalUId,subject,body,location,start,end,isAllDay,showAs,categories,type,seriesMasterId";

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
}

interface PageFetchResult {
  data: OutlookEventsListResponse;
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
  url.searchParams.set("$select", EVENT_SELECT_FIELDS);

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
      Prefer: `odata.maxpagesize=${DEFAULT_PAGE_SIZE}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch((error) => {
    if (isRequestTimeoutError(error)) {
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

// Graph's calendarView delta expands recurring series, but each expanded
// "occurrence" item carries only id, type, seriesMasterId, start, and end.
// All other properties (iCalUId, subject, showAs, ...) live on the master.
// Graph lists the master itself with the series' first start/end.
const isSeriesMaster = (event: OutlookCalendarEvent): boolean => event.type === "seriesMaster";

const isUnhydratedInstance = (
  event: OutlookCalendarEvent,
): event is OutlookCalendarEvent & { seriesMasterId: string } =>
  Boolean(event.seriesMasterId) && !event.iCalUId;

const fetchSeriesMaster = async (
  accessToken: string,
  seriesMasterId: string,
): Promise<OutlookCalendarEvent | null> => {
  const url = `${MICROSOFT_GRAPH_API}/me/events/${encodeURIComponent(seriesMasterId)}?$select=${EVENT_SELECT_FIELDS}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch((error) => {
    if (isRequestTimeoutError(error)) {
      throw new EventsFetchError(
        `Failed to fetch series master: timeout after ${REQUEST_TIMEOUT_MS}ms`,
        408,
        false,
      );
    }

    throw error;
  });

  if (response.status === HTTP_STATUS.NOT_FOUND) {
    await response.body?.cancel?.();
    return null;
  }

  if (!response.ok) {
    const responseText = await response.text();
    const apiError = parseMicrosoftApiErrorFromText(responseText);
    const authRequired = isAuthError(response.status, apiError);

    throw new EventsFetchError(
      `Failed to fetch series master: ${response.status}: ${responseText}`,
      response.status,
      authRequired,
      apiError,
    );
  }

  const responseBody = await response.json();
  return outlookEventSchema.assert(responseBody);
};

const hydrateRecurringInstances = async (
  accessToken: string,
  events: OutlookCalendarEvent[],
): Promise<OutlookCalendarEvent[]> => {
  const mastersById = new Map<string, OutlookCalendarEvent>();
  for (const event of events) {
    if (isSeriesMaster(event) && event.id) {
      mastersById.set(event.id, event);
    }
  }

  const missingMasterIds = new Set<string>();
  for (const event of events) {
    if (isUnhydratedInstance(event) && !mastersById.has(event.seriesMasterId)) {
      missingMasterIds.add(event.seriesMasterId);
    }
  }

  for (const masterId of missingMasterIds) {
    const master = await fetchSeriesMaster(accessToken, masterId);
    if (master) {
      mastersById.set(masterId, master);
    }
  }

  const hydrated: OutlookCalendarEvent[] = [];
  for (const event of events) {
    if (isSeriesMaster(event)) {
      // The master's own start/end duplicates its first occurrence
      continue;
    }

    if (!isUnhydratedInstance(event)) {
      hydrated.push(event);
      continue;
    }

    const master = mastersById.get(event.seriesMasterId);
    if (!master) {
      // Master deleted between expansion and lookup; instance is orphaned
      continue;
    }

    hydrated.push({ ...master, ...event });
  }

  return hydrated;
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

  for (const event of initialResult.data.value ?? []) {
    if (event["@removed"]) {
      const uid = event.iCalUId ?? event.id;
      if (uid) {
        cancelledEventUids.push(uid);
      }
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

    for (const event of pageResult.data.value ?? []) {
      if (event["@removed"]) {
        const uid = event.iCalUId ?? event.id;
        if (uid) {
          cancelledEventUids.push(uid);
        }
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
    events: await hydrateRecurringInstances(accessToken, events),
    fullSyncRequired: false,
    isDeltaSync,
    nextDeltaLink: lastDeltaLink,
  };

  if (isDeltaSync) {
    result.cancelledEventUids = cancelledEventUids;
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
      startTime: parseEventDateTime(start),
      startTimeZone: start.timeZone,
      title: event.subject,
      uid: event.iCalUId,
    });
  }

  return result;
};

export { fetchCalendarEvents, fetchCalendarName, parseOutlookEvents, EventsFetchError };
