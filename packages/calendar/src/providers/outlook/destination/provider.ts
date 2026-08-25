import { HTTP_STATUS, KEEPER_CATEGORY, PROVIDER_PUSH_REQUEST_TIMEOUT_MS } from "@keeper.sh/constants";
import {
  microsoftApiErrorSchema,
  outlookEventListSchema,
  outlookEventSchema,
} from "@keeper.sh/data-schemas";
import type {
  DeleteResult,
  EventPresence,
  ListRemoteEventsOptions,
  MaterializedSyncableEvent,
  ProviderThrottleMetrics,
  PushEchoComparison,
  PushResult,
  RemoteEvent,
} from "../../../core/types";
import type { OutlookEvent } from "@keeper.sh/data-schemas";
import type { EventUpdate } from "../../../core/sync-engine/types";
import { comparePushEchoObservations } from "../../../core/events/push-echo";
import type { PushEchoObservation } from "../../../core/events/push-echo";
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

/* The engine names a mirror by the id a delete would target; Graph rewrites that id on a move, so
   Outlook also needs the uid the mapping carries to tell a moved mirror from a deleted one. */
interface OutlookVerificationTarget {
  deleteId: string;
  uid?: string;
}

const toVerificationTarget = (target: OutlookVerificationTarget | string): OutlookVerificationTarget => {
  if (typeof target === "string") {
    return { deleteId: target };
  }
  return target;
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

interface OutlookUpdateBody extends Omit<OutlookEvent, "body" | "location" | "recurrence"> {
  body: OutlookEvent["body"] | null;
  location: OutlookEvent["location"] | null;
  recurrence: OutlookEvent["recurrence"] | null;
}

const buildOutlookUpdateBody = (resource: OutlookEvent): OutlookUpdateBody => ({
  ...resource,
  body: resource.body ?? null,
  location: resource.location ?? null,
  recurrence: resource.recurrence ?? null,
});

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
          headers: {
            ...getHeaders(),
            Prefer: `outlook.body-content-type="text"`,
          },
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
        results.push({
          deleteId: created.id,
          echo: compareOutlookCreateEcho(resource, created),
          remoteId: created.iCalUId ?? created.id,
          success: true,
        });
      } catch (error) {
        if (config.signal?.aborted) {
          throw error;
        }
        results.push(createCaughtFailure(error));
      }
    }

    return results;
  };

  const updateEvents = async (updates: EventUpdate[]): Promise<PushResult[]> => {
    await refreshIfNeeded();
    const results: PushResult[] = [];

    for (const update of updates) {
      try {
        config.signal?.throwIfAborted();
        const resource = serializeOutlookEvent(update.event);
        const url = new URL(`${MICROSOFT_GRAPH_API}/me/events/${update.deleteId}`);

        const response = await sendRequestWithRetry(url, {
          body: JSON.stringify(buildOutlookUpdateBody(resource)),
          headers: {
            ...getHeaders(),
            Prefer: `outlook.body-content-type="text"`,
          },
          method: "PATCH",
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
        const updated = outlookEventSchema.assert(body);
        results.push({
          deleteId: updated.id ?? update.deleteId,
          echo: compareOutlookCreateEcho(resource, updated),
          remoteId: updated.iCalUId ?? updated.id ?? update.deleteId,
          success: true,
        });
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
        // A 404 means nothing was there to remove, so it carries no removal evidence.
        if (response.ok) {
          results.push({ removedObject: true, success: true });
          continue;
        }
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
      });

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
      });

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

  const readVerificationResponse = (url: URL): Promise<Response> =>
    sendRequestWithRetry(url, {
      headers: {
        Authorization: `Bearer ${tokenState.accessToken}`,
        Prefer: `outlook.body-content-type="text"`,
      },
      method: "GET",
    });

  const presenceOfEvent = (identifier: string, body: unknown): EventPresence => {
    if (!outlookEventSchema.allows(body)) {
      return { identifier, status: "unknown" };
    }

    const remoteEvent = toOutlookRemoteEvent(outlookEventSchema.assert(body));
    if (!remoteEvent) {
      return { identifier, status: "unknown" };
    }

    return { event: remoteEvent, identifier, status: "present" };
  };

  /* Graph re-keys an item when it moves between folders of a mailbox, so the dead item id proves
     nothing on its own. The iCalUId survives the move and is the only handle that still names it. */
  const resolvePresenceByUid = async (identifier: string, uid: string): Promise<EventPresence> => {
    const url = new URL(`${MICROSOFT_GRAPH_API}/me/events`);
    url.searchParams.set("$filter", `iCalUId eq '${uid.replaceAll("'", "''")}'`);
    url.searchParams.set(
      "$select",
      "id,iCalUId,subject,body,location,start,end,isAllDay,showAs,categories",
    );

    const response = await readVerificationResponse(url);
    if (!response.ok) {
      await response.body?.cancel?.();
      return { identifier, status: "unknown" };
    }

    const body = await response.json();
    if (!outlookEventListSchema.allows(body)) {
      return { identifier, status: "unknown" };
    }

    const events = outlookEventListSchema.assert(body).value ?? [];
    // The whole mailbox holds nothing under the uid either, so the mirror is positively gone.
    if (events.length === 0) {
      return { identifier, status: "absent" };
    }

    const matched = events.find((event) => event.iCalUId === uid);
    if (!matched) {
      return { identifier, status: "unknown" };
    }

    return presenceOfEvent(identifier, matched);
  };

  const verifyTarget = async (target: OutlookVerificationTarget): Promise<EventPresence> => {
    const url = new URL(`${MICROSOFT_GRAPH_API}/me/events/${target.deleteId}`);
    url.searchParams.set(
      "$select",
      "id,iCalUId,subject,body,location,start,end,isAllDay,showAs,categories",
    );

    const response = await readVerificationResponse(url);
    if (response.ok) {
      return presenceOfEvent(target.deleteId, await response.json());
    }

    await response.body?.cancel?.();
    // A refusal is not an observation of the object, so it can never stand in for its absence.
    if (response.status !== HTTP_STATUS.NOT_FOUND) {
      return { identifier: target.deleteId, status: "unknown" };
    }

    if (!target.uid) {
      return { identifier: target.deleteId, status: "unknown" };
    }

    return await resolvePresenceByUid(target.deleteId, target.uid);
  };

  const verifyEventsExist = async (
    targets: (OutlookVerificationTarget | string)[],
  ): Promise<EventPresence[]> => {
    await refreshIfNeeded();
    const report: EventPresence[] = [];

    for (const entry of targets) {
      config.signal?.throwIfAborted();

      const target = toVerificationTarget(entry);
      try {
        report.push(await verifyTarget(target));
      } catch (error) {
        if (config.signal?.aborted) {
          throw error;
        }
        // A read that failed tells us nothing about the object, so it leaves the mirror unproven.
        report.push({ identifier: target.deleteId, status: "unknown" });
      }
    }

    return report;
  };

  return {
    deleteEvents,
    getRemoteEventsByIds,
    getThrottleMetrics,
    listRemoteEvents,
    normalizeEvent: normalizeOutlookEvent,
    pushEvents,
    updateEvents,
    verifyEventsExist,
  };
};

export { createOutlookSyncProvider };
export type { OutlookSyncProviderConfig };
