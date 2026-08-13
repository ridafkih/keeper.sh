import { HTTP_STATUS, KEEPER_CATEGORY, PROVIDER_PUSH_REQUEST_TIMEOUT_MS } from "@keeper.sh/constants";
import {
  microsoftApiErrorSchema,
  outlookEventListSchema,
  outlookEventSchema,
} from "@keeper.sh/data-schemas";
import type {
  DeleteResult,
  ListRemoteEventsOptions,
  MaterializedSyncableEvent,
  ProviderThrottleMetrics,
  PushResult,
  RemoteEvent,
} from "../../../core/types";
import { getErrorMessage } from "../../../core/utils/error";
import { ensureValidToken } from "../../../core/oauth/ensure-valid-token";
import type { TokenState, TokenRefresher } from "../../../core/oauth/ensure-valid-token";
import { withBackoff } from "../../../core/utils/backoff";
import type { BackoffRetry } from "../../../core/utils/backoff";
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
import { createEditableEventContentHash } from "../../../core/events/content-hash";

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

  const calendarEventsUrl = `${MICROSOFT_GRAPH_API}/me/calendars/${encodeURIComponent(config.externalCalendarId)}/events`;

  const throttleMetrics: ProviderThrottleMetrics = { retryAfterMs: 0, retryCount: 0 };

  const recordThrottleRetry = (retry: BackoffRetry): void => {
    throttleMetrics.retryCount += 1;
    throttleMetrics.retryAfterMs += retry.delayMs;
  };

  const sendRequest = async (url: URL, init: RequestInit): Promise<Response> => {
    if (config.rateLimiter) {
      await config.rateLimiter.acquire(1, config.signal);
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

  const sendRequestWithRetry = (url: URL, init: RequestInit): Promise<Response> =>
    withBackoff(() => sendRequest(url, init), {
      getRetryDelayMs: getThrottleRetryDelayMs,
      maxRetries: OUTLOOK_MAX_THROTTLE_RETRIES,
      onRetry: recordThrottleRetry,
      shouldRetry: isThrottledError,
      signal: config.signal,
    });

  const pushEvents = async (events: MaterializedSyncableEvent[]): Promise<PushResult[]> => {
    await refreshIfNeeded();
    const results: PushResult[] = [];

    for (const event of events) {
      try {
        const resource = serializeOutlookEvent(event);
        const url = new URL(calendarEventsUrl);

        const response = await sendRequestWithRetry(url, {
          body: JSON.stringify(resource),
          headers: getHeaders(),
          method: "POST",
        });

        if (!response.ok) {
          results.push({
            error: await readGraphErrorMessage(response),
            errorType: "MicrosoftGraphHttpError",
            statusCode: response.status,
            success: false,
          });
          continue;
        }

        const body = await response.json();
        const created = outlookEventSchema.assert(body);
        results.push({ deleteId: created.id, remoteId: created.iCalUId ?? created.id, success: true });
      } catch (error) {
        if (config.signal?.aborted) {
          throw error;
        }
        results.push(createCaughtFailure(error));
      }
    }

    return results;
  };

  const deleteEvents = async (eventIds: string[]): Promise<DeleteResult[]> => {
    await refreshIfNeeded();
    const results: DeleteResult[] = [];

    for (const eventId of eventIds) {
      try {
        const url = new URL(`${MICROSOFT_GRAPH_API}/me/events/${eventId}`);

        const response = await sendRequestWithRetry(url, {
          headers: { Authorization: `Bearer ${tokenState.accessToken}` },
          method: "DELETE",
        });

        if (!response.ok && response.status !== HTTP_STATUS.NOT_FOUND) {
          results.push({
            error: await readGraphErrorMessage(response),
            errorType: "MicrosoftGraphHttpError",
            statusCode: response.status,
            success: false,
          });
          continue;
        }

        await response.body?.cancel?.();
        results.push({ success: true });
      } catch (error) {
        if (config.signal?.aborted) {
          throw error;
        }
        results.push(createCaughtFailure(error));
      }
    }

    return results;
  };

  const buildOutlookEventsUrl = (
    lookbackStart: Date,
    nextLink: string | null,
  ): URL => {
    if (nextLink) {
      return new URL(nextLink);
    }
    const baseUrl = new URL(calendarEventsUrl);
    baseUrl.searchParams.set(
      "$filter",
      `end/dateTime ge '${lookbackStart.toISOString()}'`,
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
      const url = buildOutlookEventsUrl(options.timeMin, nextLink);

      const response = await sendRequestWithRetry(url, {
        headers: {
          Authorization: `Bearer ${tokenState.accessToken}`,
          Prefer: `outlook.body-content-type="text"`,
        },
        method: "GET",
      });

      if (!response.ok) {
        throw new Error(await readGraphErrorMessage(response));
      }

      const body = await response.json();
      const data = outlookEventListSchema.assert(body);

      for (const event of data.value ?? []) {
        const startTime = parseEventTime(event.start, event.isAllDay);
        const endTime = parseEventTime(event.end, event.isAllDay);

        if (!event.id || !event.iCalUId || !startTime || !endTime) {
          continue;
        }

        const availability = parseRemoteAvailability(event.showAs);
        remoteEvents.push({
          deleteId: event.id,
          editableAvailability: availability,
          editableContentHash: createEditableEventContentHash({
            availability,
            description: event.body?.content,
            endTime,
            isAllDay: event.isAllDay,
            location: event.location?.displayName,
            startTime,
            summary: event.subject ?? "",
          }),
          endTime,
          isKeeperEvent: event.categories?.includes(KEEPER_CATEGORY) ?? false,
          supportedAvailabilities: ["busy", "free", "oof", "workingElsewhere"],
          startTime,
          uid: event.iCalUId,
        });
      }

      nextLink = data["@odata.nextLink"] ?? null;
    } while (nextLink);

    return remoteEvents;
  };

  const getThrottleMetrics = (): ProviderThrottleMetrics => ({ ...throttleMetrics });

  return {
    deleteEvents,
    getThrottleMetrics,
    listRemoteEvents,
    normalizeEvent: normalizeOutlookEvent,
    pushEvents,
  };
};

export { createOutlookSyncProvider };
export type { OutlookSyncProviderConfig };
