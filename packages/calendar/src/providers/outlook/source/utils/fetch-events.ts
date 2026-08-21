import type {
  FetchEventsOptions,
  FetchEventsResult,
  OutlookCalendarEvent,
  OutlookEventsListResponse,
  EventTimeSlot,
} from "../types";
import type { MicrosoftApiError, OutlookDateTime } from "../../types";
import type { RedisRateLimiter } from "../../../../core/utils/redis-rate-limiter";
import { MICROSOFT_GRAPH_API, GONE_STATUS } from "../../shared/api";
import { isAuthError, isSimpleAuthError } from "../../shared/errors";
import { parseEventTime } from "../../shared/date-time";
import { microsoftApiErrorSchema, outlookEventListSchema } from "@keeper.sh/data-schemas";
import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import { isKeeperEvent } from "../../../../core/events/identity";
import { resolveTimeZone } from "../../../../ics/utils/timezone-instant";
import { buildTimeoutSignal } from "../../../../core/utils/fetch-with-timeout";
import { measureProviderRequest, measureSegment, measureSyncSegment } from "../../../../core/telemetry/segments";

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
/*
 * Each series master is expanded through its own paginated /instances request. Running them a few
 * at a time turns a full resync of a calendar with many recurring series from minutes into seconds
 * without changing the data fetched. The limit is kept well below Microsoft Graph's per-mailbox
 * concurrency ceiling so the parallelism does not trigger throttling.
 */
const SERIES_MASTER_EXPANSION_CONCURRENCY = 3;

const mapWithConcurrency = async <Item, Result>(
  items: Item[],
  limit: number,
  worker: (item: Item) => Promise<Result>,
): Promise<Result[]> => {
  const results: Result[] = [];
  const queue = items.map((item, index) => ({ index, item }));
  let cursor = 0;
  let failed = false;
  const runWorker = async (): Promise<void> => {
    while (!failed && cursor < queue.length) {
      const entry = queue[cursor];
      cursor += 1;
      if (!entry) {
        continue;
      }
      try {
        results[entry.index] = await worker(entry.item);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
};
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
  "originalEndTimeZone",
  "originalStartTimeZone",
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
  rateLimiter?: RedisRateLimiter;
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

const requestEventsPage = async (
  options: PageFetchOptions,
  url: URL,
): Promise<PageFetchResult | FullSyncRequiredResult> => {
  const { accessToken } = options;
  const timeout = buildTimeoutSignal(REQUEST_TIMEOUT_MS, options.signal);

  const response = await measureProviderRequest(() => fetch(url.toString(), {
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
  }));

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

  const responseBody = await measureSegment("work.provider_http_ms", () => response.json());
  return measureSyncSegment("work.transform_ms", () => ({
    data: outlookEventListSchema.assert(responseBody),
    fullSyncRequired: false,
  }));
};

const fetchEventsPage = async (
  options: PageFetchOptions,
): Promise<PageFetchResult | FullSyncRequiredResult> => {
  const url = getRequestUrl(options);

  const { rateLimiter } = options;
  if (!rateLimiter) {
    return await requestEventsPage(options, url);
  }

  const permit = await rateLimiter.acquirePermit?.(options.signal);
  if (!permit) {
    await rateLimiter.acquire(1, options.signal);
  }
  try {
    return await requestEventsPage(options, url);
  } finally {
    await permit?.release();
  }
};

const fetchSeriesMasterInstances = async (
  accessToken: string,
  calendarId: string,
  masterId: string,
  timeMin: Date,
  timeMax: Date,
  signal?: AbortSignal,
  rateLimiter?: RedisRateLimiter,
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
      rateLimiter,
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

interface ExpandedSeriesMasters {
  events: OutlookCalendarEvent[];
  unexpandedSeriesMasterCount: number;
}

const expandSeriesMasters = async (
  accessToken: string,
  calendarId: string,
  events: OutlookCalendarEvent[],
  timeMin: Date,
  timeMax: Date,
  signal?: AbortSignal,
  rateLimiter?: RedisRateLimiter,
): Promise<ExpandedSeriesMasters> => {
  const passthrough: OutlookCalendarEvent[] = [];
  const masterIds: string[] = [];
  for (const event of events) {
    if (event.type === SERIES_MASTER_TYPE && event.id) {
      masterIds.push(event.id);
    } else {
      passthrough.push(event);
    }
  }
  const instanceGroups = await mapWithConcurrency(
    masterIds,
    SERIES_MASTER_EXPANSION_CONCURRENCY,
    (masterId) => fetchSeriesMasterInstances(
      accessToken,
      calendarId,
      masterId,
      timeMin,
      timeMax,
      signal,
      rateLimiter,
    ),
  );
  const unexpandedSeriesMasterCount = instanceGroups.filter((instances) => instances.length === 0).length;
  const expanded = instanceGroups.flat();
  return { events: [...passthrough, ...expanded], unexpandedSeriesMasterCount };
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
  const { accessToken, calendarId, deltaLink, timeMin, timeMax, rateLimiter, signal } = options;

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
    rateLimiter,
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
      rateLimiter,
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
  let unexpandedSeriesMasterCount = 0;
  if (timeMin && timeMax) {
    const expansion = await expandSeriesMasters(
      accessToken,
      calendarId,
      latestChangedEvents,
      timeMin,
      timeMax,
      signal,
      rateLimiter,
    );
    latestChangedEvents = deduplicateOutlookEvents(expansion.events);
    ({ unexpandedSeriesMasterCount } = expansion);
  }
  const result: FetchEventsResult = {
    events: latestChangedEvents.filter((event) => !event["@removed"] && !event.isCancelled),
    fullSyncRequired: false,
    isDeltaSync,
    nextDeltaLink: lastDeltaLink,
    unexpandedSeriesMasterCount,
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

const resolveOutlookStartTimeZone = (
  originalTimeZone: string | undefined,
  responseTimeZone: string,
): string => {
  if (originalTimeZone) {
    try {
      const resolvedOriginalTimeZone = resolveTimeZone(originalTimeZone);
      if (resolvedOriginalTimeZone) {
        return resolvedOriginalTimeZone;
      }
    } catch (error) {
      if (!(error instanceof RangeError)) {
        throw error;
      }
    }
  }

  // Graph responses are requested in UTC.
  // Fail ingestion on an unsupported response timezone instead of discarding its semantics.
  const resolvedResponseTimeZone = resolveTimeZone(responseTimeZone);
  if (!resolvedResponseTimeZone) {
    throw new RangeError("Outlook event response timezone is missing");
  }
  return resolvedResponseTimeZone;
};

interface OutlookEventInstant {
  endTime: Date;
  startTime: Date;
  startTimeZone: string;
}

/*
 * Graph answers with zones it cannot name (`tzone://Microsoft/Custom`) and with
 * dateTime shapes outside its own contract; both raise RangeError.
 */
const parseOutlookEventInstant = (
  event: OutlookCalendarEvent,
  start: OutlookDateTime,
  end: OutlookDateTime,
): OutlookEventInstant | null => {
  try {
    const startTime = parseEventTime(start, event.isAllDay);
    const endTime = parseEventTime(end, event.isAllDay);
    if (!startTime || !endTime) {
      return null;
    }
    return {
      endTime,
      startTime,
      startTimeZone: resolveOutlookStartTimeZone(event.originalStartTimeZone, start.timeZone),
    };
  } catch (error) {
    if (error instanceof RangeError) {
      return null;
    }
    throw error;
  }
};

interface ParsedOutlookEventDiagnostics {
  events: EventTimeSlot[];
  selfAuthoredCount: number;
  unrepresentableCount: number;
}

const parseOutlookEventsWithDiagnostics = (
  events: OutlookCalendarEvent[],
): ParsedOutlookEventDiagnostics => {
  const result: EventTimeSlot[] = [];
  let selfAuthoredCount = 0;
  let unrepresentableCount = 0;

  for (const event of events) {
    if (
      !event.start?.dateTime
      || !event.start.timeZone
      || !event.end?.dateTime
      || !event.end.timeZone
      || !event.iCalUId
    ) {
      unrepresentableCount += 1;
      continue;
    }
    if (isKeeperEvent(event.iCalUId)) {
      selfAuthoredCount += 1;
      continue;
    }
    if (event.categories?.includes(KEEPER_CATEGORY)) {
      selfAuthoredCount += 1;
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

    const instant = parseOutlookEventInstant(event, start, end);
    if (!instant) {
      unrepresentableCount += 1;
      continue;
    }

    result.push({
      ...availability && { availability },
      description: event.body?.content,
      endTime: instant.endTime,
      isAllDay: event.isAllDay ?? false,
      location: event.location?.displayName,
      sourceEventId: event.id,
      startTime: instant.startTime,
      startTimeZone: instant.startTimeZone,
      ...event.subject && { title: event.subject },
      uid: event.iCalUId,
    });
  }

  return { events: result, selfAuthoredCount, unrepresentableCount };
};

const parseOutlookEvents = (events: OutlookCalendarEvent[]): EventTimeSlot[] =>
  parseOutlookEventsWithDiagnostics(events).events;

export {
  fetchCalendarEvents,
  fetchCalendarName,
  parseOutlookEvents,
  parseOutlookEventsWithDiagnostics,
  EventsFetchError,
};
