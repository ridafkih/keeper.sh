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
  PushEchoComparison,
  PushResult,
  RemoteEditableFields,
  RemoteEvent,
  RemoteEventListing,
  RemoteEventPresence,
  RemoteEventReference,
} from "../../../core/types";
import type { OutlookEvent } from "@keeper.sh/data-schemas";
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
import { listUserCalendars } from "../source/utils/list-calendars";
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

const EMPTY_PROBE_RESULT = 0;
const SINGLE_PROBE_RESULT = "1";

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

const createEditableFields = (event: {
  body?: { content?: string } | null;
  isAllDay?: boolean | null;
  location?: { displayName?: string } | null;
  subject?: string | null;
}): RemoteEditableFields => ({
  isAllDay: event.isAllDay ?? false,
  summary: event.subject ?? "",
  ...(event.body?.content && { description: event.body.content }),
  ...(event.location?.displayName && { location: event.location.displayName }),
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
  ): Promise<RemoteEventListing> => {
    await refreshIfNeeded();
    const remoteEvents: RemoteEvent[] = [];
    let rawItemCount = 0;
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

      const rawItems = data.value ?? [];
      rawItemCount += rawItems.length;
      for (const event of rawItems) {
        const startTime = parseEventTime(event.start, event.isAllDay);
        const endTime = parseEventTime(event.end, event.isAllDay);

        if (!event.id || !event.iCalUId || !startTime || !endTime) {
          continue;
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
        remoteEvents.push({
          deleteId: event.id,
          editableAvailability: availability,
          editableContent,
          editableContentHash: hashEditableEventContentSnapshot(editableContent),
          editableFields: createEditableFields(event),
          endTime,
          isKeeperEvent: event.categories?.includes(KEEPER_CATEGORY) ?? false,
          supportedAvailabilities: ["busy", "free", "oof", "workingElsewhere"],
          startTime,
          uid: event.iCalUId,
        });
      }

      nextLink = data["@odata.nextLink"] ?? null;
    } while (nextLink);

    return { items: remoteEvents, rawItemCount };
  };

  const getThrottleMetrics = (): ProviderThrottleMetrics => ({ ...throttleMetrics });

  /*
   * A Graph event id is not stable: restoring the item from Deleted Items, moving it
   * between folders or migrating the mailbox reassigns it while the iCalUId survives. A
   * 404 on the recorded id therefore says nothing about the copy, and reading it as an
   * absence would let two-way sync destroy an original whose copy is plainly there.
   */
  const findEventByUidIn = async (
    collectionUrl: string,
    uid: string,
  ): Promise<RemoteEventPresence> => {
    const url = new URL(collectionUrl);
    url.searchParams.set("$filter", `iCalUId eq '${uid.replaceAll("'", "''")}'`);
    url.searchParams.set("$select", "id");
    url.searchParams.set("$top", SINGLE_PROBE_RESULT);

    const response = await fetchWithTimeout(url, {
      headers: { Authorization: `Bearer ${tokenState.accessToken}` },
      method: "GET",
    }, PROVIDER_PUSH_REQUEST_TIMEOUT_MS, config.signal);

    if (!response.ok) {
      const body = await response.json();
      const { error } = microsoftApiErrorSchema.assert(body);
      throw new Error(error?.message ?? response.statusText);
    }
    const { value } = outlookEventListSchema.assert(await response.json());
    if ((value ?? []).length === EMPTY_PROBE_RESULT) {
      return "absent";
    }
    return "present";
  };

  /*
   * Graph scopes /me/events to the mailbox's default calendar, which is almost never the
   * destination calendar, so the destination collection has to be asked first. A copy the
   * user dragged into another folder is still a copy, and any sighting of it has to block
   * the deletion of the original, so every calendar the mailbox lists is asked before the
   * copy is called gone. A calendar list that cannot be read is refused, never assumed
   * empty: listUserCalendars throws and the caller reads a throw as "do not delete".
   */
  const findEventByUid = async (uid: string): Promise<RemoteEventPresence> => {
    const inDestination = await findEventByUidIn(calendarEventsUrl, uid);
    if (inDestination === "present") {
      return inDestination;
    }
    const inMailboxDefault = await findEventByUidIn(`${MICROSOFT_GRAPH_API}/me/events`, uid);
    if (inMailboxDefault === "present") {
      return inMailboxDefault;
    }

    const calendars = await listUserCalendars(
      tokenState.accessToken,
      config.signal,
    );
    for (const calendar of calendars) {
      if (calendar.id === config.externalCalendarId) {
        continue;
      }
      const elsewhere = await findEventByUidIn(
        `${MICROSOFT_GRAPH_API}/me/calendars/${encodeURIComponent(calendar.id)}/events`,
        uid,
      );
      if (elsewhere === "present") {
        return elsewhere;
      }
    }
    return "absent";
  };

  /*
   * Graph pages the list read and a user can strip the Keeper.sh category from a copy,
   * so a mapping missing from the listing is only a candidate. The original on the
   * source is destroyed only once Graph answers not-found for the copy itself.
   */
  const probeRemoteEvent = async (
    reference: RemoteEventReference,
  ): Promise<RemoteEventPresence> => {
    await refreshIfNeeded();
    const url = new URL(
      `${MICROSOFT_GRAPH_API}/me/events/${encodeURIComponent(reference.deleteId)}`,
    );
    url.searchParams.set("$select", "id");

    const response = await fetchWithTimeout(url, {
      headers: { Authorization: `Bearer ${tokenState.accessToken}` },
      method: "GET",
    }, PROVIDER_PUSH_REQUEST_TIMEOUT_MS, config.signal);

    if (response.status === HTTP_STATUS.NOT_FOUND) {
      await response.body?.cancel?.();
      return findEventByUid(reference.uid);
    }
    if (!response.ok) {
      const body = await response.json();
      const { error } = microsoftApiErrorSchema.assert(body);
      throw new Error(error?.message ?? response.statusText);
    }
    await response.body?.cancel?.();
    return "present";
  };

  return {
    deleteEvents,
    getThrottleMetrics,
    listRemoteEvents,
    normalizeEvent: normalizeOutlookEvent,
    probeRemoteEvent,
    pushEvents,
  };
};

export { createOutlookSyncProvider };
export type { OutlookSyncProviderConfig };
