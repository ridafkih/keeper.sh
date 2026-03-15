import { generateEventUid, isKeeperEvent } from "../../../core/events/identity";
import { getOAuthSyncWindowStart } from "../../../core/oauth/sync-window";
import { ensureValidToken } from "../../../core/oauth/ensure-valid-token";
import type { TokenState, TokenRefresher } from "../../../core/oauth/ensure-valid-token";
import type { DeleteResult, PushResult, RemoteEvent, SyncableEvent } from "../../../core/types";
import { googleEventListSchema } from "@keeper.sh/data-schemas";
import { HTTP_STATUS } from "@keeper.sh/constants";
import { GOOGLE_CALENDAR_API, GOOGLE_CALENDAR_MAX_RESULTS } from "../shared/api";
import { executeBatchChunked } from "../shared/batch";
import type { BatchSubRequest } from "../shared/batch";
import { parseEventTime } from "../shared/date-time";
import { serializeGoogleEvent } from "./serialize-event";
import { buildRecurrenceRule } from "./recurrence";

interface GoogleSyncProviderConfig {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  externalCalendarId: string;
  calendarId: string;
  userId: string;
  refreshAccessToken?: TokenRefresher;
}

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

  const pushEvents = async (events: SyncableEvent[]): Promise<PushResult[]> => {
    await refreshIfNeeded();

    const results: PushResult[] = Array.from({ length: events.length });
    const batchEntries: { batchIndex: number; originalIndex: number; uid: string }[] = [];
    const subRequests: BatchSubRequest[] = [];

    for (let index = 0; index < events.length; index++) {
      const event = events[index];
      if (!event) {
        results[index] = { success: true };
        continue;
      }

      const uid = generateEventUid();
      const resource = serializeGoogleEvent(event, uid, buildRecurrenceRule(event));

      if (!resource) {
        results[index] = { success: true };
        continue;
      }

      batchEntries.push({ batchIndex: subRequests.length, originalIndex: index, uid });
      subRequests.push({
        method: "POST",
        path: eventsPath,
        headers: { "Content-Type": "application/json" },
        body: resource,
      });
    }

    if (subRequests.length === 0) {
      return results;
    }

    const batchResponses = await executeBatchChunked(subRequests, tokenState.accessToken);

    for (const entry of batchEntries) {
      const response = batchResponses[entry.batchIndex];
      if (!response) {
        results[entry.originalIndex] = { error: "Missing batch response", success: false };
        continue;
      }

      if (response.statusCode >= 200 && response.statusCode < 300) {
        results[entry.originalIndex] = { remoteId: entry.uid, success: true };
      } else if (response.statusCode === 409) {
        results[entry.originalIndex] = { remoteId: entry.uid, success: true };
      } else {
        const errorBody = response.body as Record<string, unknown> | null;
        const errorObj = errorBody?.error as Record<string, unknown> | undefined;
        const errorMessage = (errorObj?.message as string) ?? `Batch sub-request failed with status ${response.statusCode}`;
        results[entry.originalIndex] = { error: errorMessage, success: false };
      }
    }

    return results;
  };

  const deleteEvents = async (eventIds: string[]): Promise<DeleteResult[]> => {
    await refreshIfNeeded();

    if (eventIds.length === 0) {
      return [];
    }

    const findSubRequests: BatchSubRequest[] = eventIds.map((uid) => ({
      method: "GET",
      path: `${eventsPath}?iCalUID=${encodeURIComponent(uid)}`,
    }));

    const findResponses = await executeBatchChunked(findSubRequests, tokenState.accessToken);

    const deleteSubRequests: BatchSubRequest[] = [];
    const deleteIndexToOriginalIndex: number[] = [];
    const results: DeleteResult[] = Array.from({ length: eventIds.length });

    for (let index = 0; index < eventIds.length; index++) {
      const findResponse = findResponses[index];

      if (!findResponse || findResponse.statusCode !== 200) {
        results[index] = { success: true };
        continue;
      }

      const findBody = findResponse.body as Record<string, unknown> | null;
      const items = findBody?.items as Record<string, unknown>[] | undefined;
      const existing = items?.[0];
      const eventId = existing?.id as string | undefined;

      if (!eventId) {
        results[index] = { success: true };
        continue;
      }

      deleteIndexToOriginalIndex.push(index);
      deleteSubRequests.push({
        method: "DELETE",
        path: `${eventsPath}/${encodeURIComponent(eventId)}`,
      });
    }

    if (deleteSubRequests.length === 0) {
      return results;
    }

    const deleteResponses = await executeBatchChunked(deleteSubRequests, tokenState.accessToken);

    for (let deleteIndex = 0; deleteIndex < deleteResponses.length; deleteIndex++) {
      const originalIndex = deleteIndexToOriginalIndex[deleteIndex];
      if (typeof originalIndex !== "number") {
        continue;
      }

      const deleteResponse = deleteResponses[deleteIndex];
      if (!deleteResponse) {
        results[originalIndex] = { error: "Missing batch response", success: false };
        continue;
      }

      if (deleteResponse.statusCode >= 200 && deleteResponse.statusCode < 300) {
        results[originalIndex] = { success: true };
      } else if (deleteResponse.statusCode === HTTP_STATUS.NOT_FOUND) {
        results[originalIndex] = { success: true };
      } else {
        const errorBody = deleteResponse.body as Record<string, unknown> | null;
        const errorObj = errorBody?.error as Record<string, unknown> | undefined;
        const errorMessage = (errorObj?.message as string) ?? `Delete failed with status ${deleteResponse.statusCode}`;
        results[originalIndex] = { error: errorMessage, success: false };
      }
    }

    return results;
  };

  const listRemoteEvents = async (): Promise<RemoteEvent[]> => {
    await refreshIfNeeded();
    const remoteEvents: RemoteEvent[] = [];
    let pageToken: string | null = null;
    const lookbackStart = getOAuthSyncWindowStart();
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 2);

    do {
      const url = new URL(
        `calendars/${encodeURIComponent(config.externalCalendarId)}/events`,
        GOOGLE_CALENDAR_API,
      );
      url.searchParams.set("maxResults", String(GOOGLE_CALENDAR_MAX_RESULTS));
      url.searchParams.set("timeMin", lookbackStart.toISOString());
      url.searchParams.set("timeMax", futureDate.toISOString());
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${tokenState.accessToken}` },
        method: "GET",
      });

      if (!response.ok) {
        throw new Error(response.statusText);
      }

      const body = await response.json();
      const data = googleEventListSchema.assert(body);

      for (const event of data.items ?? []) {
        if (!event.iCalUID || !isKeeperEvent(event.iCalUID)) {
          continue;
        }
        const startTime = parseEventTime(event.start);
        const endTime = parseEventTime(event.end);
        if (!startTime || !endTime) {
          continue;
        }
        remoteEvents.push({
          deleteId: event.iCalUID,
          endTime,
          isKeeperEvent: true,
          startTime,
          uid: event.iCalUID,
        });
      }

      pageToken = data.nextPageToken ?? null;
    } while (pageToken);

    return remoteEvents;
  };

  return { pushEvents, deleteEvents, listRemoteEvents };
};

export { createGoogleSyncProvider };
export type { GoogleSyncProviderConfig };
