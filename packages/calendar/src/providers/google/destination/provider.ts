import { OAuthCalendarProvider } from "../../../core/oauth/provider";
import { createOAuthDestinationProvider } from "../../../core/oauth/create-provider";
import { generateEventUid, isKeeperEvent } from "../../../core/events/identity";
import { getErrorMessage } from "../../../core/utils/error";
import { getOAuthSyncWindowStart } from "../../../core/oauth/sync-window";
import { ensureValidToken } from "../../../core/oauth/ensure-valid-token";
import type { TokenState, TokenRefresher } from "../../../core/oauth/ensure-valid-token";
import type { BroadcastSyncStatus, DeleteResult, GoogleCalendarConfig, ListRemoteEventsOptions, PushResult, RemoteEvent, SyncableEvent } from "../../../core/types";
import type { DestinationProvider } from "../../../core/sync/destinations";
import type { OAuthTokenProvider } from "../../../core/oauth/provider";
import type { RefreshLockStore } from "../../../core/oauth/refresh-coordinator";
import { googleApiErrorSchema, googleEventListSchema } from "@keeper.sh/data-schemas";
import type { GoogleEvent } from "@keeper.sh/data-schemas";
import { HTTP_STATUS } from "@keeper.sh/constants";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { widelog } from "widelogger";
import { GOOGLE_CALENDAR_API, GOOGLE_CALENDAR_MAX_RESULTS } from "../shared/api";
import { executeBatchChunked } from "../shared/batch";
import type { BatchSubRequest } from "../shared/batch";
import { hasRateLimitMessage, isAuthError } from "../shared/errors";
import { parseEventTime } from "../shared/date-time";
import { canSerializeGoogleEvent, serializeGoogleEvent } from "./serialize-event";
import { buildRecurrenceRule } from "./recurrence";
import { getGoogleAccountsForUser } from "./sync";
import type { GoogleAccount } from "./sync";

interface GoogleCalendarProviderConfig {
  database: BunSQLDatabase;
  oauthProvider: OAuthTokenProvider;
  broadcastSyncStatus?: BroadcastSyncStatus;
  refreshLockStore?: RefreshLockStore | null;
}

class GoogleCalendarProviderInstance extends OAuthCalendarProvider<GoogleCalendarConfig> {
  readonly name = "Google Calendar";
  readonly id = "google";

  protected oauthProvider: OAuthTokenProvider;

  constructor(config: GoogleCalendarConfig, oauthProvider: OAuthTokenProvider) {
    super(config);
    this.oauthProvider = oauthProvider;
  }

  protected isRateLimitError(error: string | undefined): boolean {
    return hasRateLimitMessage(error) && this.rateLimiter !== null;
  }

  async listRemoteEvents(options: ListRemoteEventsOptions): Promise<RemoteEvent[]> {
    await this.ensureValidToken();
    const remoteEvents: RemoteEvent[] = [];

    let pageToken: string | null = null;
    const lookbackStart = getOAuthSyncWindowStart();

    do {
      const url = this.buildListEventsUrl(lookbackStart, options.until, pageToken);

      const response = await fetch(url, {
        headers: this.headers,
        method: "GET",
      });

      if (!response.ok) {
        const body = await response.json();
        const { error } = googleApiErrorSchema.assert(body);

        if (isAuthError(response.status, error)) {
          await this.markNeedsReauthentication();
        }

        throw new Error(error?.message ?? response.statusText);
      }

      const body = await response.json();
      const data = googleEventListSchema.assert(body);

      for (const event of data.items ?? []) {
        const remoteEvent = GoogleCalendarProviderInstance.transformGoogleEvent(event);
        if (remoteEvent) {
          remoteEvents.push(remoteEvent);
        }
      }

      pageToken = data.nextPageToken ?? null;
    } while (pageToken);

    return remoteEvents;
  }

  private buildListEventsUrl(lookbackStart: Date, until: Date, pageToken: string | null): URL {
    const url = new URL(
      `calendars/${encodeURIComponent(this.config.externalCalendarId)}/events`,
      GOOGLE_CALENDAR_API,
    );

    url.searchParams.set("maxResults", String(GOOGLE_CALENDAR_MAX_RESULTS));
    url.searchParams.set("timeMin", lookbackStart.toISOString());
    url.searchParams.set("timeMax", until.toISOString());
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    return url;
  }

  private static transformGoogleEvent(event: GoogleEvent): RemoteEvent | null {
    if (!event.iCalUID || !isKeeperEvent(event.iCalUID)) {
      return null;
    }

    const startTime = parseEventTime(event.start);
    const endTime = parseEventTime(event.end);

    if (!startTime || !endTime) {
      return null;
    }

    return {
      deleteId: event.iCalUID,
      endTime,
      isKeeperEvent: isKeeperEvent(event.iCalUID),
      startTime,
      uid: event.iCalUID,
    };
  }

  protected async pushEvent(event: SyncableEvent): Promise<PushResult> {
    widelog.set("destination.calendar_id", this.config.calendarId);
    widelog.set("operation.name", "google-calendar:push");
    widelog.set("source.provider", this.id);
    widelog.set("user.id", this.config.userId);

    try {
      const uid = generateEventUid();
      const resource = serializeGoogleEvent(
        event,
        uid,
        buildRecurrenceRule(event),
      );

      if (!resource) {
        return { success: true };
      }

      const result = await this.createEvent(resource);
      if (result.success) {
        return { remoteId: uid, success: true };
      }
      return result;
    } catch (error) {
      widelog.errorFields(error);
      return { error: getErrorMessage(error), success: false };
    }
  }

  private async createEvent(resource: GoogleEvent): Promise<PushResult> {
    const url = new URL(
      `calendars/${encodeURIComponent(this.config.externalCalendarId)}/events`,
      GOOGLE_CALENDAR_API,
    );

    const response = await fetch(url, {
      body: JSON.stringify(resource),
      headers: this.headers,
      method: "POST",
    });

    if (!response.ok) {
      const body = await response.json();
      const { error } = googleApiErrorSchema.assert(body);

      const errorMessage = error?.message ?? response.statusText;

      if (isAuthError(response.status, error)) {
        return this.handleAuthErrorResponse(errorMessage);
      }

      return { error: errorMessage, success: false };
    }

    await response.json();
    return { success: true };
  }

  protected async deleteEvent(uid: string): Promise<DeleteResult> {
    widelog.set("destination.calendar_id", this.config.calendarId);
    widelog.set("operation.name", "google-calendar:delete");
    widelog.set("source.provider", this.id);
    widelog.set("user.id", this.config.userId);

    try {
      const existing = await this.findEventByUid(uid);

      if (!existing?.id) {
        return { success: true };
      }

      const url = new URL(
        `calendars/${encodeURIComponent(this.config.externalCalendarId)}/events/${encodeURIComponent(existing.id)}`,
        GOOGLE_CALENDAR_API,
      );

      const response = await fetch(url, {
        headers: this.headers,
        method: "DELETE",
      });

      if (!response.ok && response.status !== HTTP_STATUS.NOT_FOUND) {
        const body = await response.json();
        const { error } = googleApiErrorSchema.assert(body);
        const errorMessage = error?.message ?? response.statusText;

        if (isAuthError(response.status, error)) {
          return this.handleAuthErrorResponse(errorMessage);
        }

        return { error: errorMessage, success: false };
      }

      await response.body?.cancel?.();
      return { success: true };
    } catch (error) {
      widelog.errorFields(error);
      return { error: getErrorMessage(error), success: false };
    }
  }

  private async findEventByUid(uid: string): Promise<GoogleEvent | null> {
    const url = new URL(
      `calendars/${encodeURIComponent(this.config.externalCalendarId)}/events`,
      GOOGLE_CALENDAR_API,
    );

    url.searchParams.set("iCalUID", uid);

    const response = await widelog.time.measure("find_event_by_uid.duration_ms", () =>
      fetch(url, {
        headers: this.headers,
        method: "GET",
      }),
    );

    if (!response.ok) {
      await response.body?.cancel?.();
      widelog.set("find_event_by_uid.status", response.status);
      return null;
    }

    const body = await response.json();
    const { items } = googleEventListSchema.assert(body);
    const [item] = items ?? [];
    return item ?? null;
  }

}

const createGoogleCalendarProvider = (
  config: GoogleCalendarProviderConfig,
): DestinationProvider => {
  const { database, oauthProvider, broadcastSyncStatus, refreshLockStore } = config;

  return createOAuthDestinationProvider<GoogleAccount, GoogleCalendarConfig>({
    broadcastSyncStatus,
    buildConfig: (db, account, broadcast) => ({
      accessToken: account.accessToken,
      accessTokenExpiresAt: account.accessTokenExpiresAt,
      accountId: account.accountId,
      broadcastSyncStatus: broadcast,
      calendarId: account.calendarId,
      database: db,
      externalCalendarId: "primary",
      refreshToken: account.refreshToken,
      userId: account.userId,
    }),
    createProviderInstance: (providerConfig, oauth) =>
      new GoogleCalendarProviderInstance(providerConfig, oauth),
    database,
    getAccountsForUser: getGoogleAccountsForUser,
    oauthProvider,
    prepareLocalEvents: (events) => events.filter((event) => canSerializeGoogleEvent(event)),
    refreshLockStore,
  });
};

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

export { createGoogleCalendarProvider, createGoogleSyncProvider };
export type { GoogleCalendarProviderConfig, GoogleSyncProviderConfig };
