import { generateDeterministicEventUid, isKeeperEvent } from "../../../core/events/identity";
import { getOAuthSyncWindowStart } from "../../../core/oauth/sync-window";
import { ensureValidToken } from "../../../core/oauth/ensure-valid-token";
import type { TokenState, TokenRefresher } from "../../../core/oauth/ensure-valid-token";
import type { RedisRateLimiter } from "../../../core/utils/redis-rate-limiter";
import type { DeleteResult, PushResult, RemoteEvent, SyncableEvent } from "../../../core/types";
import { googleApiErrorSchema, googleEventListSchema } from "@keeper.sh/data-schemas";
import { HTTP_STATUS, PROVIDER_PUSH_REQUEST_TIMEOUT_MS } from "@keeper.sh/constants";
import { fetchWithTimeout } from "../../../core/utils/fetch-with-timeout";
import { GOOGLE_CALENDAR_API, GOOGLE_CALENDAR_MAX_RESULTS, GONE_STATUS } from "../shared/api";
import { withBackoff } from "../shared/backoff";
import { executeBatchChunked } from "../shared/batch";
import { isRateLimitApiError, parseGoogleApiError } from "../shared/errors";
import type { BatchSubRequest } from "../shared/batch";
import { parseEventTime } from "../shared/date-time";
import { serializeGoogleEvent } from "./serialize-event";

interface GoogleSyncProviderConfig {
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

class GoogleCalendarApiError extends Error {
  public readonly status: number;
  public readonly apiError: ReturnType<typeof parseGoogleApiError>;
  constructor(status: number, body: string) {
    super(`Google Calendar API ${status}: ${body}`);
    this.name = "GoogleCalendarApiError";
    this.status = status;
    this.apiError = parseGoogleApiError(body);
  }
}

const isDirectEventId = (identifier: string): boolean => !identifier.includes("@");

const extractBatchErrorMessage = (body: unknown, fallbackStatus: number): string => {
  const fallback = `Batch sub-request failed with status ${fallbackStatus}`;
  if (!googleApiErrorSchema.allows(body)) {
    return fallback;
  }
  return googleApiErrorSchema.assert(body).error?.message ?? fallback;
};

const extractEventIdFromLookup = (body: unknown): string | undefined => {
  if (!googleEventListSchema.allows(body)) {
    return;
  }
  const firstItem = googleEventListSchema.assert(body).items?.[0];
  if (!firstItem) {
    return;
  }
  return firstItem.id;
};

const createGoogleSyncProvider = (config: GoogleSyncProviderConfig) => {
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

  const eventsPath = `/calendar/v3/calendars/${encodeURIComponent(config.externalCalendarId)}/events`;

  // Writes go through events.import, which upserts by iCalUID: re-pushing an existing event updates it rather than 409ing.
  const buildPushRequest = (event: SyncableEvent): { uid: string; request: BatchSubRequest } | null => {
    const uid = generateDeterministicEventUid(`${event.id}:${config.externalCalendarId}`);
    const resource = serializeGoogleEvent(event, uid);
    if (!resource) {
      return null;
    }
    return {
      uid,
      request: {
        method: "POST",
        path: `${eventsPath}/import`,
        headers: { "Content-Type": "application/json" },
        body: resource,
      },
    };
  };

  const pushEvents = async (events: SyncableEvent[]): Promise<PushResult[]> => {
    await refreshIfNeeded();

    const results: PushResult[] = Array.from({ length: events.length });
    const pending: { index: number; uid: string; batchIndex: number }[] = [];
    const requests: BatchSubRequest[] = [];

    for (let index = 0; index < events.length; index++) {
      const event = events[index];
      if (!event) {
        results[index] = { success: true };
        continue;
      }

      const built = buildPushRequest(event);
      if (!built) {
        results[index] = { success: true };
        continue;
      }

      pending.push({ index, uid: built.uid, batchIndex: requests.length });
      requests.push(built.request);
    }

    if (requests.length === 0) {
      return results;
    }

    const responses = await executeBatchChunked(requests, tokenState.accessToken, { rateLimiter: config.rateLimiter, signal: config.signal, timeoutMs: PROVIDER_PUSH_REQUEST_TIMEOUT_MS });

    for (const entry of pending) {
      const response = responses[entry.batchIndex];
      if (!response) {
        results[entry.index] = {
          error: "Missing batch response",
          errorType: "GoogleBatchProtocolError",
          success: false,
        };
      } else if (response.statusCode >= 200 && response.statusCode < 300) {
        results[entry.index] = { remoteId: entry.uid, success: true };
      } else {
        results[entry.index] = {
          error: extractBatchErrorMessage(response.body, response.statusCode),
          errorType: "GoogleCalendarApiError",
          statusCode: response.statusCode,
          success: false,
        };
      }
    }

    return results;
  };

  const resolveDeleteRequests = async (
    eventIds: string[],
    results: DeleteResult[],
  ): Promise<{ subRequests: BatchSubRequest[]; indexMap: number[] }> => {
    const directSubRequests: BatchSubRequest[] = [];
    const directIndexMap: number[] = [];
    const lookupIds: string[] = [];
    const lookupOriginalIndices: number[] = [];

    for (let index = 0; index < eventIds.length; index++) {
      const identifier = eventIds[index];
      if (!identifier) {
        results[index] = { success: true };
        continue;
      }

      if (isDirectEventId(identifier)) {
        directIndexMap.push(index);
        directSubRequests.push({
          method: "DELETE",
          path: `${eventsPath}/${encodeURIComponent(identifier)}`,
        });
      } else {
        lookupIds.push(identifier);
        lookupOriginalIndices.push(index);
      }
    }

    if (lookupIds.length === 0) {
      return { subRequests: directSubRequests, indexMap: directIndexMap };
    }

    const findSubRequests: BatchSubRequest[] = lookupIds.map((uid) => ({
      method: "GET",
      path: `${eventsPath}?iCalUID=${encodeURIComponent(uid)}`,
    }));

    const findResponses = await executeBatchChunked(findSubRequests, tokenState.accessToken, { rateLimiter: config.rateLimiter, signal: config.signal, timeoutMs: PROVIDER_PUSH_REQUEST_TIMEOUT_MS });

    for (let findIndex = 0; findIndex < lookupIds.length; findIndex++) {
      const originalIndex = lookupOriginalIndices[findIndex];
      if (typeof originalIndex !== "number") {
        continue;
      }

      const findResponse = findResponses[findIndex];
      if (!findResponse || findResponse.statusCode !== 200) {
        results[originalIndex] = { success: true };
        continue;
      }

      const eventId = extractEventIdFromLookup(findResponse.body);
      if (!eventId) {
        results[originalIndex] = { success: true };
        continue;
      }

      directIndexMap.push(originalIndex);
      directSubRequests.push({
        method: "DELETE",
        path: `${eventsPath}/${encodeURIComponent(eventId)}`,
      });
    }

    return { subRequests: directSubRequests, indexMap: directIndexMap };
  };

  const deleteEvents = async (eventIds: string[]): Promise<DeleteResult[]> => {
    await refreshIfNeeded();

    if (eventIds.length === 0) {
      return [];
    }

    const results: DeleteResult[] = Array.from({ length: eventIds.length });
    const { subRequests, indexMap } = await resolveDeleteRequests(eventIds, results);

    if (subRequests.length === 0) {
      return results;
    }

    const deleteResponses = await executeBatchChunked(subRequests, tokenState.accessToken, { rateLimiter: config.rateLimiter, signal: config.signal, timeoutMs: PROVIDER_PUSH_REQUEST_TIMEOUT_MS });

    for (let deleteIndex = 0; deleteIndex < deleteResponses.length; deleteIndex++) {
      const originalIndex = indexMap[deleteIndex];
      if (typeof originalIndex !== "number") {
        continue;
      }

      const deleteResponse = deleteResponses[deleteIndex];
      if (!deleteResponse) {
        results[originalIndex] = {
          error: "Missing batch response",
          errorType: "GoogleBatchProtocolError",
          success: false,
        };
        continue;
      }

      if (deleteResponse.statusCode >= 200 && deleteResponse.statusCode < 300) {
        results[originalIndex] = { success: true };
      } else if (deleteResponse.statusCode === HTTP_STATUS.NOT_FOUND || deleteResponse.statusCode === GONE_STATUS) {
        // 404 (never existed) and 410 (already deleted) both mean the event is gone — the desired end state.
        results[originalIndex] = { success: true };
      } else {
        const errorMessage = extractBatchErrorMessage(deleteResponse.body, deleteResponse.statusCode);
        results[originalIndex] = {
          error: errorMessage,
          errorType: "GoogleCalendarApiError",
          statusCode: deleteResponse.statusCode,
          success: false,
        };
      }
    }

    return results;
  };

  const fetchRemoteEventsPage = async (pageToken: string | null): Promise<{
    items: RemoteEvent[];
    nextPageToken: string | null;
  }> => {
    if (config.rateLimiter) {
      await config.rateLimiter.acquire(1);
    }

    const url = new URL(
      `calendars/${encodeURIComponent(config.externalCalendarId)}/events`,
      GOOGLE_CALENDAR_API,
    );
    url.searchParams.set("maxResults", String(GOOGLE_CALENDAR_MAX_RESULTS));
    url.searchParams.set("timeMin", getOAuthSyncWindowStart().toISOString());
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 2);
    url.searchParams.set("timeMax", futureDate.toISOString());
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await fetchWithTimeout(
      url,
      {
        headers: { Authorization: `Bearer ${tokenState.accessToken}` },
        method: "GET",
      },
      PROVIDER_PUSH_REQUEST_TIMEOUT_MS,
      config.signal,
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new GoogleCalendarApiError(response.status, errorBody);
    }

    const body = await response.json();
    const data = googleEventListSchema.assert(body);

    const items: RemoteEvent[] = [];
    for (const event of data.items ?? []) {
      if (!event.iCalUID || !isKeeperEvent(event.iCalUID)) {
        continue;
      }
      const startTime = parseEventTime(event.start);
      const endTime = parseEventTime(event.end);
      if (!startTime || !endTime) {
        continue;
      }
      items.push({
        deleteId: event.id ?? event.iCalUID,
        endTime,
        isKeeperEvent: true,
        startTime,
        uid: event.iCalUID,
      });
    }

    return { items, nextPageToken: data.nextPageToken ?? null };
  };

  const listRemoteEvents = async (): Promise<RemoteEvent[]> => {
    await refreshIfNeeded();
    const remoteEvents: RemoteEvent[] = [];
    let pageToken: string | null = null;

    do {
      const currentPageToken: string | null = pageToken;
      const page: { items: RemoteEvent[]; nextPageToken: string | null } = await withBackoff(
        () => fetchRemoteEventsPage(currentPageToken),
        {
          signal: config.signal,
          shouldRetry: (error) =>
            error instanceof GoogleCalendarApiError && isRateLimitApiError(error.status, error.apiError),
        },
      );
      remoteEvents.push(...page.items);
      pageToken = page.nextPageToken;
    } while (pageToken);

    return remoteEvents;
  };

  return { pushEvents, deleteEvents, listRemoteEvents };
};

export { createGoogleSyncProvider };
export type { GoogleSyncProviderConfig };
