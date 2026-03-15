import { HTTP_STATUS, KEEPER_CATEGORY } from "@keeper.sh/constants";
import type { OutlookEvent } from "@keeper.sh/data-schemas";
import {
  microsoftApiErrorSchema,
  outlookEventListSchema,
  outlookEventSchema,
} from "@keeper.sh/data-schemas";
import type{ BroadcastSyncStatus, DeleteResult, ListRemoteEventsOptions, OutlookCalendarConfig, PushResult, RemoteEvent, SyncableEvent } from "../../../core/types";
import type{ DestinationProvider } from "../../../core/sync/destinations";
import type{ OAuthTokenProvider } from "../../../core/oauth/provider";
import type{ RefreshLockStore } from "../../../core/oauth/refresh-coordinator";
import{ OAuthCalendarProvider } from "../../../core/oauth/provider";
import{ createOAuthDestinationProvider } from "../../../core/oauth/create-provider";
import{ getErrorMessage } from "../../../core/utils/error";
import{ getOAuthSyncWindowStart } from "../../../core/oauth/sync-window";
import { ensureValidToken } from "../../../core/oauth/ensure-valid-token";
import type { TokenState, TokenRefresher } from "../../../core/oauth/ensure-valid-token";
import { widelog } from "widelogger";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { MICROSOFT_GRAPH_API, OUTLOOK_PAGE_SIZE } from "../shared/api";
import { hasRateLimitMessage, isAuthError } from "../shared/errors";
import { parseEventTime } from "../shared/date-time";
import { serializeOutlookEvent } from "./serialize-event";
import type { OutlookAccount } from "./sync";
import { getOutlookAccountsForUser } from "./sync";

interface OutlookCalendarProviderConfig {
  database: BunSQLDatabase;
  oauthProvider: OAuthTokenProvider;
  broadcastSyncStatus?: BroadcastSyncStatus;
  refreshLockStore?: RefreshLockStore | null;
}

class OutlookCalendarProviderInstance extends OAuthCalendarProvider<OutlookCalendarConfig> {
  readonly name = "Outlook Calendar";
  readonly id = "outlook";

  protected oauthProvider: OAuthTokenProvider;

  constructor(config: OutlookCalendarConfig, oauthProvider: OAuthTokenProvider) {
    super(config);
    this.oauthProvider = oauthProvider;
  }

  protected isRateLimitError(error: string | undefined): boolean {
    return hasRateLimitMessage(error) && this.rateLimiter !== null;
  }

  async listRemoteEvents(options: ListRemoteEventsOptions): Promise<RemoteEvent[]> {
    await this.ensureValidToken();
    const remoteEvents: RemoteEvent[] = [];
    let nextLink: string | null = null;

    const lookbackStart = getOAuthSyncWindowStart();

    do {
      const url = OutlookCalendarProviderInstance.buildListEventsUrl(
        lookbackStart,
        options.until,
        nextLink,
      );

      const response = await fetch(url, {
        headers: this.headers,
        method: "GET",
      });

      if (!response.ok) {
        const body = await response.json();
        const { error } = microsoftApiErrorSchema.assert(body);

        if (isAuthError(response.status, error)) {
          await this.markNeedsReauthentication();
        }

        throw new Error(error?.message ?? response.statusText);
      }

      const body = await response.json();
      const data = outlookEventListSchema.assert(body);

      for (const event of data.value ?? []) {
        const remoteEvent = OutlookCalendarProviderInstance.transformOutlookEvent(event);
        if (remoteEvent) {
          remoteEvents.push(remoteEvent);
        }
      }

      nextLink = data["@odata.nextLink"] ?? null;
    } while (nextLink);

    return remoteEvents;
  }

  private static buildListEventsUrl(
    lookbackStart: Date,
    until: Date,
    nextLink: string | null,
  ): URL {
    if (nextLink) {
      return new URL(nextLink);
    }

    const url = new URL(`${MICROSOFT_GRAPH_API}/me/calendar/events`);
    url.searchParams.set(
      "$filter",
      `categories/any(c:c eq '${KEEPER_CATEGORY}') and start/dateTime ge '${lookbackStart.toISOString()}' and start/dateTime le '${until.toISOString()}'`,
    );
    url.searchParams.set("$top", String(OUTLOOK_PAGE_SIZE));
    url.searchParams.set("$select", "id,iCalUId,subject,start,end,categories");

    return url;
  }

  private static transformOutlookEvent(event: OutlookEvent): RemoteEvent | null {
    const startTime = parseEventTime(event.start);
    const endTime = parseEventTime(event.end);

    if (!event.id || !event.iCalUId || !startTime || !endTime) {
      return null;
    }

    return {
      deleteId: event.id,
      endTime,
      isKeeperEvent: event.categories?.includes(KEEPER_CATEGORY) ?? false,
      startTime,
      uid: event.iCalUId,
    };
  }

  protected async pushEvent(event: SyncableEvent): Promise<PushResult> {
      widelog.set("destination.calendar_id", this.config.calendarId);
      widelog.set("operation.name", "outlook-calendar:push");
      widelog.set("source.provider", this.id);
      widelog.set("user.id", this.config.userId);

      try {
        const resource = serializeOutlookEvent(event);
        return await this.createEvent(resource);
      } catch (error) {
        widelog.errorFields(error);
        return {
          error: getErrorMessage(error),
          success: false,
        };
      }
  }

  private async createEvent(resource: OutlookEvent): Promise<PushResult> {
    const url = new URL(`${MICROSOFT_GRAPH_API}/me/calendar/events`);

    const response = await fetch(url, {
      body: JSON.stringify(resource),
      headers: this.headers,
      method: "POST",
    });

    if (!response.ok) {
      const body = await response.json();
      const { error } = microsoftApiErrorSchema.assert(body);
      const errorMessage = error?.message ?? response.statusText;

      if (isAuthError(response.status, error)) {
        return this.handleAuthErrorResponse(errorMessage);
      }

      return { error: errorMessage, success: false };
    }

    const body = await response.json();
    const event = outlookEventSchema.assert(body);
    return { deleteId: event.id, remoteId: event.iCalUId, success: true };
  }

  protected async deleteEvent(eventId: string): Promise<DeleteResult> {
    widelog.set("destination.calendar_id", this.config.calendarId);
    widelog.set("operation.name", "outlook-calendar:delete");
    widelog.set("source.provider", this.id);
    widelog.set("user.id", this.config.userId);

    try {
      const url = new URL(`${MICROSOFT_GRAPH_API}/me/events/${eventId}`);

      const response = await fetch(url, {
        headers: this.headers,
        method: "DELETE",
      });

      if (!response.ok && response.status !== HTTP_STATUS.NOT_FOUND) {
        const body = await response.json();
        const { error } = microsoftApiErrorSchema.assert(body);
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
      return {
        error: getErrorMessage(error),
        success: false,
      };
    }
  }
}

const createOutlookCalendarProvider = (
  config: OutlookCalendarProviderConfig,
): DestinationProvider => {
  const { database, oauthProvider, broadcastSyncStatus, refreshLockStore } = config;

  return createOAuthDestinationProvider<OutlookAccount, OutlookCalendarConfig>({
    broadcastSyncStatus,
    buildConfig: (db, account, broadcast) => ({
      accessToken: account.accessToken,
      accessTokenExpiresAt: account.accessTokenExpiresAt,
      accountId: account.accountId,
      broadcastSyncStatus: broadcast,
      calendarId: account.calendarId,
      database: db,
      refreshToken: account.refreshToken,
      userId: account.userId,
    }),
    createProviderInstance: (providerConfig, oauth) =>
      new OutlookCalendarProviderInstance(providerConfig, oauth),
    database,
    getAccountsForUser: getOutlookAccountsForUser,
    oauthProvider,
    prepareLocalEvents: (events) =>
      events.filter((event) => event.availability !== "workingElsewhere"),
    refreshLockStore,
  });
};

interface OutlookSyncProviderConfig {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  calendarId: string;
  userId: string;
  refreshAccessToken?: TokenRefresher;
}

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

  const pushEvents = async (events: SyncableEvent[]): Promise<PushResult[]> => {
    await refreshIfNeeded();
    const results: PushResult[] = [];

    for (const event of events) {
      try {
        const resource = serializeOutlookEvent(event);
        const url = new URL(`${MICROSOFT_GRAPH_API}/me/calendar/events`);

        const response = await fetch(url, {
          body: JSON.stringify(resource),
          headers: getHeaders(),
          method: "POST",
        });

        if (!response.ok) {
          const body = await response.json();
          const { error } = microsoftApiErrorSchema.assert(body);
          results.push({ error: error?.message ?? response.statusText, success: false });
          continue;
        }

        const body = await response.json();
        const created = outlookEventSchema.assert(body);
        results.push({ deleteId: created.id, remoteId: created.iCalUId, success: true });
      } catch (error) {
        results.push({ error: getErrorMessage(error), success: false });
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

        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${tokenState.accessToken}` },
          method: "DELETE",
        });

        if (!response.ok && response.status !== HTTP_STATUS.NOT_FOUND) {
          const body = await response.json();
          const { error } = microsoftApiErrorSchema.assert(body);
          results.push({ error: error?.message ?? response.statusText, success: false });
          continue;
        }

        await response.body?.cancel?.();
        results.push({ success: true });
      } catch (error) {
        results.push({ error: getErrorMessage(error), success: false });
      }
    }

    return results;
  };

  const buildOutlookEventsUrl = (
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
      const url = buildOutlookEventsUrl(lookbackStart, futureDate, nextLink);

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${tokenState.accessToken}` },
        method: "GET",
      });

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

export { createOutlookCalendarProvider, createOutlookSyncProvider };
export type { OutlookCalendarProviderConfig, OutlookSyncProviderConfig };
