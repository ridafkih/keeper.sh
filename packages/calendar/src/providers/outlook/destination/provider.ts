import { HTTP_STATUS, KEEPER_CATEGORY, PROVIDER_PUSH_REQUEST_TIMEOUT_MS } from "@keeper.sh/constants";
import {
  microsoftApiErrorSchema,
  outlookEventListSchema,
  outlookEventSchema,
} from "@keeper.sh/data-schemas";
import type {
  DeleteResult,
  ListRemoteEventsOptions,
  PushResult,
  RemoteEvent,
  SyncableEvent,
} from "../../../core/types";
import { getErrorMessage } from "../../../core/utils/error";
import { ensureValidToken } from "../../../core/oauth/ensure-valid-token";
import type { TokenState, TokenRefresher } from "../../../core/oauth/ensure-valid-token";
import { MICROSOFT_GRAPH_API, OUTLOOK_PAGE_SIZE } from "../shared/api";
import { parseEventTime } from "../shared/date-time";
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
  signal?: AbortSignal;
}

const createCaughtFailure = (error: unknown): PushResult | DeleteResult => {
  let errorType = "UnknownError";
  if (error instanceof Error) {
    errorType = error.name;
  }
  return { error: getErrorMessage(error), errorType, success: false };
};

const parseRemoteAvailability = (showAs: string | undefined): SyncableEvent["availability"] => {
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

  const pushEvents = async (events: SyncableEvent[]): Promise<PushResult[]> => {
    await refreshIfNeeded();
    const results: PushResult[] = [];

    for (const event of events) {
      try {
        const resource = serializeOutlookEvent(event);
        const url = new URL(calendarEventsUrl);

        const response = await fetchWithTimeout(url, {
          body: JSON.stringify(resource),
          headers: getHeaders(),
          method: "POST",
        }, PROVIDER_PUSH_REQUEST_TIMEOUT_MS, config.signal);

        if (!response.ok) {
          const body = await response.json();
          const { error } = microsoftApiErrorSchema.assert(body);
          results.push({
            error: error?.message ?? response.statusText,
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

        const response = await fetchWithTimeout(url, {
          headers: { Authorization: `Bearer ${tokenState.accessToken}` },
          method: "DELETE",
        }, PROVIDER_PUSH_REQUEST_TIMEOUT_MS, config.signal);

        if (!response.ok && response.status !== HTTP_STATUS.NOT_FOUND) {
          const body = await response.json();
          const { error } = microsoftApiErrorSchema.assert(body);
          results.push({
            error: error?.message ?? response.statusText,
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
      `categories/any(c:c eq '${KEEPER_CATEGORY}') and end/dateTime ge '${lookbackStart.toISOString()}'`,
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

      const response = await fetchWithTimeout(url, {
        headers: {
          Authorization: `Bearer ${tokenState.accessToken}`,
          Prefer: `outlook.body-content-type="text"`,
        },
        method: "GET",
      }, PROVIDER_PUSH_REQUEST_TIMEOUT_MS, config.signal);

      if (!response.ok) {
        const body = await response.json();
        const { error } = microsoftApiErrorSchema.assert(body);
        throw new Error(error?.message ?? response.statusText);
      }

      const body = await response.json();
      const data = outlookEventListSchema.assert(body);

      for (const event of data.value ?? []) {
        const startTime = parseEventTime(event.start);
        const endTime = parseEventTime(event.end);

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

  return { pushEvents, deleteEvents, listRemoteEvents };
};

export { createOutlookSyncProvider };
export type { OutlookSyncProviderConfig };
