import { HTTP_STATUS, KEEPER_CATEGORY } from "@keeper.sh/constants";
import {
  microsoftApiErrorSchema,
  outlookEventListSchema,
  outlookEventSchema,
} from "@keeper.sh/data-schemas";
import type { DeleteResult, PushResult, RemoteEvent, SyncableEvent } from "../../../core/types";
import type { RedisRateLimiter } from "../../../core/utils/redis-rate-limiter";
import { executeBatchChunked } from "../../../core/utils/batch";
import type { BatchSubResponse } from "../../../core/utils/batch";
import { getOAuthSyncWindowStart } from "../../../core/oauth/sync-window";
import { ensureValidToken } from "../../../core/oauth/ensure-valid-token";
import type { TokenState, TokenRefresher } from "../../../core/oauth/ensure-valid-token";
import { MICROSOFT_GRAPH_API, OUTLOOK_PAGE_SIZE } from "../shared/api";
import { createOutlookBatchExecutor } from "../shared/batch";
import { parseEventTime } from "../shared/date-time";
import { serializeOutlookEvent } from "./serialize-event";

interface OutlookSyncProviderConfig {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  calendarId: string;
  userId: string;
  refreshAccessToken?: TokenRefresher;
  rateLimiter?: RedisRateLimiter;
}

const resolveErrorMessage = (body: unknown, fallback: string): string => {
  if (!microsoftApiErrorSchema.allows(body)) {
    return fallback;
  }
  return microsoftApiErrorSchema.assert(body).error?.message ?? fallback;
};

const resolvePushResult = (response: BatchSubResponse): PushResult => {
  if (response.statusCode < 200 || response.statusCode >= 300) {
    return {
      error: resolveErrorMessage(response.body, `Push failed with status ${response.statusCode}`),
      success: false,
    };
  }

  if (!outlookEventSchema.allows(response.body)) {
    return { success: true };
  }

  const event = outlookEventSchema.assert(response.body);
  if (!event.id || !event.iCalUId) {
    return { success: true };
  }

  return { deleteId: event.id, remoteId: event.iCalUId, success: true };
};

const resolveDeleteResult = (response: BatchSubResponse): DeleteResult => {
  if (response.statusCode >= 200 && response.statusCode < 300) {
    return { success: true };
  }
  if (response.statusCode === HTTP_STATUS.NOT_FOUND) {
    return { success: true };
  }
  return {
    error: resolveErrorMessage(response.body, `Delete failed with status ${response.statusCode}`),
    success: false,
  };
};

const createOutlookSyncProvider = (config: OutlookSyncProviderConfig) => {
  const batchExecutor = createOutlookBatchExecutor();
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

  const pushEvents = async (events: SyncableEvent[]): Promise<PushResult[]> => {
    await refreshIfNeeded();

    const subRequests = events.map((event) => ({
      method: "POST",
      path: "/me/calendar/events",
      headers: { "Content-Type": "application/json" },
      body: serializeOutlookEvent(event),
    }));

    const batchResponses = await executeBatchChunked(batchExecutor, subRequests, tokenState.accessToken, config.rateLimiter);
    return batchResponses.map((response) => resolvePushResult(response));
  };

  const deleteEvents = async (eventIds: string[]): Promise<DeleteResult[]> => {
    await refreshIfNeeded();

    if (eventIds.length === 0) {
      return [];
    }

    const subRequests = eventIds.map((eventId) => ({
      method: "DELETE",
      path: `/me/events/${eventId}`,
    }));

    const batchResponses = await executeBatchChunked(batchExecutor, subRequests, tokenState.accessToken, config.rateLimiter);
    return batchResponses.map((response) => resolveDeleteResult(response));
  };

  const buildEventsUrl = (
    lookbackStart: Date,
    futureDate: Date,
    nextLink: string | null,
  ): URL => {
    if (nextLink) {
      return new URL(nextLink);
    }
    const baseUrl = new URL(`${MICROSOFT_GRAPH_API}/me/calendar/events`);
    baseUrl.searchParams.set(
      "$filter",
      `categories/any(c:c eq '${KEEPER_CATEGORY}') and start/dateTime ge '${lookbackStart.toISOString()}' and start/dateTime le '${futureDate.toISOString()}'`,
    );
    baseUrl.searchParams.set("$top", String(OUTLOOK_PAGE_SIZE));
    baseUrl.searchParams.set("$select", "id,iCalUId,subject,start,end,categories");
    return baseUrl;
  };

  const listRemoteEvents = async (): Promise<RemoteEvent[]> => {
    await refreshIfNeeded();
    const remoteEvents: RemoteEvent[] = [];
    let nextLink: string | null = null;
    const lookbackStart = getOAuthSyncWindowStart();
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 2);

    do {
      if (config.rateLimiter) {
        await config.rateLimiter.acquire(1);
      }

      const url = buildEventsUrl(lookbackStart, futureDate, nextLink);

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${tokenState.accessToken}` },
        method: "GET",
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Microsoft Graph API ${response.status}: ${errorBody}`);
      }

      const body = await response.json();
      const data = outlookEventListSchema.assert(body);

      for (const event of data.value ?? []) {
        const startTime = parseEventTime(event.start);
        const endTime = parseEventTime(event.end);

        if (!event.id || !event.iCalUId || !startTime || !endTime) {
          continue;
        }

        remoteEvents.push({
          deleteId: event.id,
          endTime,
          isKeeperEvent: event.categories?.includes(KEEPER_CATEGORY) ?? false,
          startTime,
          uid: event.iCalUId,
        });
      }

      nextLink = data["@odata.nextLink"] ?? null;
    } while (nextLink);

    return remoteEvents;
  };

  return { pushEvents, deleteEvents, listRemoteEvents };
};

export { createOutlookSyncProvider };
export type { OutlookSyncProviderConfig };
