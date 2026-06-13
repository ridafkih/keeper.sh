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
  url.searchParams.set(
    "$select",
    "id,iCalUId,subject,body,location,start,end,isAllDay,showAs,categories,recurrence",
  );

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

const INSTANCES_SELECT = "id,iCalUId,subject,body,location,start,end,isAllDay,showAs,categories";

const isSeriesMasterBeforeWindow = (event: OutlookCalendarEvent, windowStart: Date): boolean => {
  const startDateTime = event.start?.dateTime;
  const endDateTime = event.end?.dateTime;
  if (!startDateTime || !endDateTime) {
    return false;
  }
  return new Date(startDateTime) < windowStart && new Date(endDateTime) < windowStart;
};

const fetchSeriesMasterInstances = async (
  accessToken: string,
  eventId: string,
  timeMin: Date,
  timeMax: Date,
): Promise<OutlookCalendarEvent[]> => {
  const instances: OutlookCalendarEvent[] = [];
  const encodedEventId = encodeURIComponent(eventId);
  const baseUrl = `${MICROSOFT_GRAPH_API}/me/events/${encodedEventId}/instances`;

  let nextLink: string | undefined = (() => {
    const url = new URL(baseUrl);
    url.searchParams.set("startDateTime", timeMin.toISOString());
    url.searchParams.set("endDateTime", timeMax.toISOString());
    url.searchParams.set("$select", INSTANCES_SELECT);
    return url.toString();
  })();

  while (nextLink) {
    let response: Response;
    try {
      response = await fetch(nextLink, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      break;
    }

    if (!response.ok) {
      break;
    }

    const body = await response.json();
    if (!outlookEventListSchema.allows(body)) {
      break;
    }
    const data = outlookEventListSchema.assert(body);
    for (const event of data.value ?? []) {
      if (!event["@removed"]) {
        instances.push(event);
      }
    }
    nextLink = data["@odata.nextLink"];
  }

  return instances;
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

  // Series masters returned by calendarView (startTime before window) cannot be
  // synced as-is. Fetch their actual instances within the window instead.
  if (timeMin && timeMax) {
    const expandedEvents: OutlookCalendarEvent[] = [];
    for (const event of events) {
      if (event.id && isSeriesMasterBeforeWindow(event, timeMin)) {
        const instances = await fetchSeriesMasterInstances(accessToken, event.id, timeMin, timeMax);
        expandedEvents.push(...instances);
      } else {
        expandedEvents.push(event);
      }
    }
    events.length = 0;
    events.push(...expandedEvents);
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

const OUTLOOK_DAY_MAP: Record<string, string> = {
  sunday: "SU",
  monday: "MO",
  tuesday: "TU",
  wednesday: "WE",
  thursday: "TH",
  friday: "FR",
  saturday: "SA",
};

const OUTLOOK_FREQUENCY_MAP: Record<string, string> = {
  daily: "DAILY",
  weekly: "WEEKLY",
  absoluteMonthly: "MONTHLY",
  relativeMonthly: "MONTHLY",
  absoluteYearly: "YEARLY",
  relativeYearly: "YEARLY",
};

const OUTLOOK_INDEX_MAP: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  last: -1,
};

const parseOutlookRecurrence = (
  recurrence: OutlookCalendarEvent["recurrence"],
): object | null => {
  const pattern = recurrence?.pattern;
  const range = recurrence?.range;
  if (!pattern?.type) {
    return null;
  }

  const frequency = OUTLOOK_FREQUENCY_MAP[pattern.type];
  if (!frequency) {
    return null;
  }

  const rule: Record<string, unknown> = { frequency };

  if (typeof pattern.interval === "number" && pattern.interval > 1) {
    rule.interval = pattern.interval;
  }

  if (
    ["weekly", "relativeMonthly", "relativeYearly"].includes(pattern.type)
    && Array.isArray(pattern.daysOfWeek)
  ) {
    const byDay = pattern.daysOfWeek.flatMap((dayName) => {
      const day = OUTLOOK_DAY_MAP[dayName.toLowerCase()];
      if (!day) {
        return [];
      }
      if (["relativeMonthly", "relativeYearly"].includes(pattern.type ?? "") && pattern.index) {
        const occurrence = OUTLOOK_INDEX_MAP[pattern.index.toLowerCase()];
        return [occurrence ? { day, occurrence } : { day }];
      }
      return [{ day }];
    });
    if (byDay.length > 0) {
      rule.byDay = byDay;
    }
  }

  if (
    ["absoluteMonthly", "absoluteYearly"].includes(pattern.type)
    && typeof pattern.dayOfMonth === "number"
    && pattern.dayOfMonth > 0
  ) {
    rule.byMonthday = [pattern.dayOfMonth];
  }

  if (
    ["absoluteYearly", "relativeYearly"].includes(pattern.type)
    && typeof pattern.month === "number"
    && pattern.month > 0
  ) {
    rule.byMonth = [pattern.month];
  }

  if (range?.type === "numbered" && typeof range.numberOfOccurrences === "number" && range.numberOfOccurrences > 0) {
    rule.count = range.numberOfOccurrences;
  } else if (range?.type === "endDate" && range.endDate && range.endDate > "1970-01-01") {
    const endDate = new Date(range.endDate);
    if (!Number.isNaN(endDate.getTime())) {
      rule.until = { date: endDate };
    }
  }

  return rule;
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
    const recurrenceRule = parseOutlookRecurrence(event.recurrence) ?? undefined;

    result.push({
      ...availability && { availability },
      description: event.body?.content,
      endTime: parseEventDateTime(end),
      isAllDay: event.isAllDay ?? false,
      location: event.location?.displayName,
      ...recurrenceRule && { recurrenceRule },
      startTime: parseEventDateTime(start),
      startTimeZone: start.timeZone,
      title: event.subject,
      uid: event.iCalUId,
    });
  }

  return result;
};

export { fetchCalendarEvents, fetchCalendarName, parseOutlookEvents, EventsFetchError };
