import { HTTP_STATUS, KEEPER_CATEGORY, PROVIDER_PUSH_REQUEST_TIMEOUT_MS } from "@keeper.sh/constants";
import {
  microsoftApiErrorSchema,
  microsoftGraphBatchResponseSchema,
  outlookEventListSchema,
  outlookEventSchema,
} from "@keeper.sh/data-schemas";
import type {
  DeleteResult,
  ListRemoteEventsOptions,
  MaterializedSyncableEvent,
  ProviderThrottleMetrics,
  PushEchoComparison,
  PushResult,
  RemoteEvent,
} from "../../../core/types";
import type { OutlookEvent } from "@keeper.sh/data-schemas";
import { comparePushEchoObservations } from "../../../core/events/push-echo";
import type { PushEchoObservation } from "../../../core/events/push-echo";
import { getErrorMessage } from "../../../core/utils/error";
import { ensureValidToken } from "../../../core/oauth/ensure-valid-token";
import type { TokenState, TokenRefresher } from "../../../core/oauth/ensure-valid-token";
import { withBackoff } from "../../../core/utils/backoff";
import type { BackoffRetry } from "../../../core/utils/backoff";
import {
  MicrosoftGraphHttpError,
  executeGraphBatch,
  isRetriableSubResponseStatus,
  isSuccessfulStatus,
  readSubResponseErrorMessage,
} from "./graph-batch";
import type {
  GraphBatchOutcome,
  GraphBatchRequest,
  GraphBatchSubResponse,
} from "./graph-batch";
import type { RedisRateLimiter } from "../../../core/utils/redis-rate-limiter";
import {
  getThrottleRetryDelayMs,
  isThrottledError,
  isThrottleStatus,
  OUTLOOK_MAX_THROTTLE_RETRIES,
  OutlookThrottledError,
  parseRetryAfterMs,
} from "../shared/throttle";
import { MICROSOFT_GRAPH_API, OUTLOOK_PAGE_SIZE } from "../shared/api";
import { parseEventTime } from "../shared/date-time";
import { normalizeOutlookEvent } from "./normalize-event";
import { serializeOutlookEvent } from "./serialize-event";
import { fetchWithTimeout } from "../../../core/utils/fetch-with-timeout";
import {
  createEditableEventContentSnapshot,
  hashEditableEventContentSnapshot,
} from "../../../core/events/content-hash";

interface OutlookSyncProviderConfig {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  externalCalendarId: string;
  calendarId: string;
  userId: string;
  refreshAccessToken?: TokenRefresher;
  rateLimiter?: RedisRateLimiter;
  signal?: AbortSignal;
}

const createCaughtFailure = (error: unknown): PushResult | DeleteResult => {
  if (error instanceof MicrosoftGraphHttpError) {
    return {
      error: error.message,
      errorType: error.name,
      statusCode: error.status,
      success: false,
    };
  }
  if (isThrottledError(error)) {
    return {
      error: error.message,
      errorType: error.name,
      statusCode: error.status,
      success: false,
    };
  }
  let errorType = "UnknownError";
  if (error instanceof Error) {
    errorType = error.name;
  }
  return { error: getErrorMessage(error), errorType, success: false };
};

const createSubResponseFailure = (response: GraphBatchSubResponse): PushResult | DeleteResult => {
  let errorType = "MicrosoftGraphHttpError";
  if (isRetriableSubResponseStatus(response.status)) {
    errorType = "OutlookThrottledError";
  }
  return {
    error: readSubResponseErrorMessage(response),
    errorType,
    statusCode: response.status,
    success: false,
  };
};

const readGraphErrorMessage = async (response: Response): Promise<string> => {
  const text = await response.text();
  try {
    const parsed: unknown = JSON.parse(text);
    if (microsoftApiErrorSchema.allows(parsed)) {
      return microsoftApiErrorSchema.assert(parsed).error?.message ?? response.statusText;
    }
    return response.statusText;
  } catch {
    return response.statusText;
  }
};

const parseRemoteAvailability = (
  showAs: string | undefined,
): MaterializedSyncableEvent["availability"] => {
  if (showAs === "free" || showAs === "oof" || showAs === "workingElsewhere") {
    return showAs;
  }
  return "busy";
};

const buildOutlookEchoObservation = (resource: OutlookEvent): PushEchoObservation | null => {
  const isAllDay = resource.isAllDay ?? false;
  const startTime = parseEventTime(resource.start, isAllDay);
  const endTime = parseEventTime(resource.end, isAllDay);
  if (!startTime || !endTime) {
    return null;
  }
  return {
    content: createEditableEventContentSnapshot({
      availability: parseRemoteAvailability(resource.showAs),
      description: resource.body?.content,
      endTime,
      isAllDay,
      location: resource.location?.displayName,
      startTime,
      summary: resource.subject ?? "",
    }),
    endTime,
    startTime,
  };
};

const toOutlookRemoteEvent = (event: OutlookEvent): RemoteEvent | null => {
  const startTime = parseEventTime(event.start, event.isAllDay);
  const endTime = parseEventTime(event.end, event.isAllDay);

  if (!event.id || !event.iCalUId || !startTime || !endTime) {
    return null;
  }

  const availability = parseRemoteAvailability(event.showAs);
  const editableContent = createEditableEventContentSnapshot({
    availability,
    description: event.body?.content,
    endTime,
    isAllDay: event.isAllDay,
    location: event.location?.displayName,
    startTime,
    summary: event.subject ?? "",
  });
  return {
    deleteId: event.id,
    editableAvailability: availability,
    editableContent,
    editableContentHash: hashEditableEventContentSnapshot(editableContent),
    endTime,
    isKeeperEvent: event.categories?.includes(KEEPER_CATEGORY) ?? false,
    startTime,
    supportedAvailabilities: ["busy", "free", "oof", "workingElsewhere"],
    uid: event.iCalUId,
  };
};

const compareOutlookCreateEcho = (
  sent: OutlookEvent,
  echo: OutlookEvent,
): PushEchoComparison => {
  if (echo.body && echo.body.contentType !== "text") {
    return { comparable: false, reason: "echo-body-not-text" };
  }
  const echoObservation = buildOutlookEchoObservation(echo);
  const sentObservation = buildOutlookEchoObservation(sent);
  if (!echoObservation || !sentObservation) {
    return { comparable: false, reason: "echo-times-missing" };
  }
  return {
    comparable: true,
    divergence: comparePushEchoObservations(sentObservation, echoObservation),
  };
};

const createOutlookSyncProvider = (config: OutlookSyncProviderConfig) => {
  const tokenState: TokenState = {
    accessToken: config.accessToken,
    accessTokenExpiresAt: config.accessTokenExpiresAt,
    refreshToken: config.refreshToken,
  };

  const refreshIfNeeded = async (): Promise<void> => {
    if (config.refreshAccessToken) {
      await ensureValidToken(tokenState, config.refreshAccessToken);
    }
  };

  const getHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${tokenState.accessToken}`,
    "Content-Type": "application/json",
  });

  const calendarEventsPath = `/me/calendars/${encodeURIComponent(config.externalCalendarId)}/events`;
  const calendarEventsUrl = `${MICROSOFT_GRAPH_API}${calendarEventsPath}`;
  const graphBatchUrl = `${MICROSOFT_GRAPH_API}/$batch`;

  const throttleMetrics: ProviderThrottleMetrics = { retryAfterMs: 0, retryCount: 0 };

  const recordThrottleRetry = (retry: BackoffRetry): void => {
    throttleMetrics.retryCount += 1;
    throttleMetrics.retryAfterMs += retry.delayMs;
  };

  const sendRequest = async (url: URL, init: RequestInit, requestCount: number): Promise<Response> => {
    if (config.rateLimiter) {
      await config.rateLimiter.acquire(requestCount, config.signal);
    }

    const response = await fetchWithTimeout(
      url,
      init,
      PROVIDER_PUSH_REQUEST_TIMEOUT_MS,
      config.signal,
    );

    if (!isThrottleStatus(response.status)) {
      return response;
    }

    const retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"));
    throw new OutlookThrottledError(
      response.status,
      retryAfterMs,
      await readGraphErrorMessage(response),
    );
  };

  const sendRequestWithRetry = (
    url: URL,
    init: RequestInit,
    requestCount: number,
  ): Promise<Response> =>
    withBackoff(() => sendRequest(url, init, requestCount), {
      getRetryDelayMs: getThrottleRetryDelayMs,
      maxRetries: OUTLOOK_MAX_THROTTLE_RETRIES,
      onRetry: recordThrottleRetry,
      shouldRetry: isThrottledError,
      signal: config.signal,
    });

  const sendBatch = async (requests: GraphBatchRequest[]): Promise<GraphBatchSubResponse[]> => {
    const response = await sendRequestWithRetry(new URL(graphBatchUrl), {
      body: JSON.stringify({ requests }),
      headers: getHeaders(),
      method: "POST",
    }, requests.length);

    if (!response.ok) {
      throw new MicrosoftGraphHttpError(response.status, await readGraphErrorMessage(response));
    }

    return microsoftGraphBatchResponseSchema.assert(await response.json()).responses;
  };

  const sendGraphBatch = (requests: GraphBatchRequest[]): Promise<Map<string, GraphBatchOutcome>> =>
    executeGraphBatch(requests, {
      onRetryRound: ({ delayMs, retriedCount }) => {
        throttleMetrics.retryCount += retriedCount;
        throttleMetrics.retryAfterMs += delayMs;
      },
      sendBatch,
      signal: config.signal,
    });

  const toPushResult = (resource: OutlookEvent, outcome: GraphBatchOutcome | undefined): PushResult => {
    if (!outcome) {
      return createCaughtFailure(new Error("Microsoft Graph batch outcome missing"));
    }
    if ("error" in outcome) {
      return createCaughtFailure(outcome.error);
    }
    const { response } = outcome;
    if (!isSuccessfulStatus(response.status)) {
      return createSubResponseFailure(response);
    }
    try {
      const created = outlookEventSchema.assert(response.body);
      return {
        deleteId: created.id,
        echo: compareOutlookCreateEcho(resource, created),
        remoteId: created.iCalUId ?? created.id,
        success: true,
      };
    } catch (error) {
      return createCaughtFailure(error);
    }
  };

  const toDeleteResult = (outcome: GraphBatchOutcome | undefined): DeleteResult => {
    if (!outcome) {
      return createCaughtFailure(new Error("Microsoft Graph batch outcome missing"));
    }
    if ("error" in outcome) {
      return createCaughtFailure(outcome.error);
    }
    const { response } = outcome;
    if (isSuccessfulStatus(response.status) || response.status === HTTP_STATUS.NOT_FOUND) {
      return { success: true };
    }
    return createSubResponseFailure(response);
  };

  const serializeForPush = (event: MaterializedSyncableEvent): OutlookEvent | PushResult => {
    try {
      return serializeOutlookEvent(event);
    } catch (error) {
      return createCaughtFailure(error);
    }
  };

  const pushEvents = async (events: MaterializedSyncableEvent[]): Promise<PushResult[]> => {
    await refreshIfNeeded();
    const serialized = events.map((event) => serializeForPush(event));
    const requests = serialized.flatMap((entry, index): GraphBatchRequest[] => {
      if ("success" in entry) {
        return [];
      }
      return [{
        body: entry,
        headers: {
          "Content-Type": "application/json",
          Prefer: `outlook.body-content-type="text"`,
        },
        id: String(index),
        method: "POST",
        url: calendarEventsPath,
      }];
    });

    const outcomes = await sendGraphBatch(requests);
    return serialized.map((entry, index) => {
      if ("success" in entry) {
        return entry;
      }
      return toPushResult(entry, outcomes.get(String(index)));
    });
  };

  const deleteEvents = async (eventIds: string[]): Promise<DeleteResult[]> => {
    await refreshIfNeeded();
    const requests = eventIds.map((eventId, index): GraphBatchRequest => ({
      id: String(index),
      method: "POST",
      url: `/me/events/${eventId}/permanentDelete`,
    }));

    const outcomes = await sendGraphBatch(requests);
    return requests.map((request) => toDeleteResult(outcomes.get(request.id)));
  };

  const buildOutlookEventsUrl = (
    lookbackStart: Date,
    lookaheadEnd: Date,
    nextLink: string | null,
  ): URL => {
    if (nextLink) {
      return new URL(nextLink);
    }
    const baseUrl = new URL(calendarEventsUrl);
    baseUrl.searchParams.set(
      "$filter",
      `end/dateTime ge '${lookbackStart.toISOString()}'`
      + ` and start/dateTime le '${lookaheadEnd.toISOString()}'`,
    );
    baseUrl.searchParams.set("$top", String(OUTLOOK_PAGE_SIZE));
    baseUrl.searchParams.set(
      "$select",
      "id,iCalUId,subject,body,location,start,end,isAllDay,showAs,categories",
    );
    return baseUrl;
  };

  const listRemoteEvents = async (
    options: ListRemoteEventsOptions,
  ): Promise<RemoteEvent[]> => {
    await refreshIfNeeded();
    const remoteEvents: RemoteEvent[] = [];
    let nextLink: string | null = null;
    do {
      const url = buildOutlookEventsUrl(options.timeMin, options.timeMax, nextLink);

      const response = await sendRequestWithRetry(url, {
        headers: {
          Authorization: `Bearer ${tokenState.accessToken}`,
          Prefer: `outlook.body-content-type="text"`,
        },
        method: "GET",
      }, 1);

      if (!response.ok) {
        throw new Error(await readGraphErrorMessage(response));
      }

      const body = await response.json();
      const data = outlookEventListSchema.assert(body);

      for (const event of data.value ?? []) {
        const remoteEvent = toOutlookRemoteEvent(event);
        if (remoteEvent) {
          remoteEvents.push(remoteEvent);
        }
      }

      nextLink = data["@odata.nextLink"] ?? null;
    } while (nextLink);

    return remoteEvents;
  };

  const getRemoteEventsByIds = async (eventIds: string[]): Promise<RemoteEvent[]> => {
    await refreshIfNeeded();
    const remoteEvents: RemoteEvent[] = [];

    for (const eventId of eventIds) {
      const url = new URL(`${MICROSOFT_GRAPH_API}/me/events/${eventId}`);
      url.searchParams.set(
        "$select",
        "id,iCalUId,subject,body,location,start,end,isAllDay,showAs,categories",
      );

      const response = await sendRequestWithRetry(url, {
        headers: {
          Authorization: `Bearer ${tokenState.accessToken}`,
          Prefer: `outlook.body-content-type="text"`,
        },
        method: "GET",
      }, 1);

      if (response.status === HTTP_STATUS.NOT_FOUND) {
        await response.body?.cancel?.();
        continue;
      }

      if (!response.ok) {
        throw new Error(await readGraphErrorMessage(response));
      }

      const body = await response.json();
      const remoteEvent = toOutlookRemoteEvent(outlookEventSchema.assert(body));
      if (remoteEvent) {
        remoteEvents.push(remoteEvent);
      }
    }

    return remoteEvents;
  };

  const getThrottleMetrics = (): ProviderThrottleMetrics => ({ ...throttleMetrics });

  const verifyEventsExist = async (deleteIds: string[]): Promise<RemoteEvent[]> => {
    await refreshIfNeeded();
    const verified: RemoteEvent[] = [];

    for (const deleteId of deleteIds) {
      config.signal?.throwIfAborted();

      const url = new URL(`${MICROSOFT_GRAPH_API}/me/events/${deleteId}`);
      url.searchParams.set(
        "$select",
        "id,iCalUId,subject,body,location,start,end,isAllDay,showAs,categories",
      );

      const response = await sendRequestWithRetry(url, {
        headers: {
          Authorization: `Bearer ${tokenState.accessToken}`,
          Prefer: `outlook.body-content-type="text"`,
        },
        method: "GET",
      }, 1);

      if (response.status === HTTP_STATUS.NOT_FOUND) {
        await response.body?.cancel?.();
        continue;
      }

      if (!response.ok) {
        throw new Error(await readGraphErrorMessage(response));
      }

      const body = await response.json();
      const remoteEvent = toOutlookRemoteEvent(outlookEventSchema.assert(body));

      if (remoteEvent) {
        verified.push(remoteEvent);
      }
    }

    return verified;
  };

  return {
    deleteEvents,
    getRemoteEventsByIds,
    getThrottleMetrics,
    listRemoteEvents,
    normalizeEvent: normalizeOutlookEvent,
    pushEvents,
    verifyEventsExist,
  };
};

export { createOutlookSyncProvider };
export type { OutlookSyncProviderConfig };
