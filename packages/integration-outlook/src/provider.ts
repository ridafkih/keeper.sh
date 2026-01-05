import { HTTP_STATUS, KEEPER_CATEGORY } from "@keeper.sh/constants";
import type { OutlookEvent } from "@keeper.sh/data-schemas";
import {
  microsoftApiErrorSchema,
  outlookEventListSchema,
  outlookEventSchema,
} from "@keeper.sh/data-schemas";
import { getStartOfToday } from "@keeper.sh/date-utils";
import type {
  BroadcastSyncStatus,
  DeleteResult,
  DestinationProvider,
  ListRemoteEventsOptions,
  OAuthTokenProvider,
  OutlookCalendarConfig,
  PushResult,
  RemoteEvent,
  SyncableEvent,
} from "@keeper.sh/integration";
import {
  OAuthCalendarProvider,
  createOAuthDestinationProvider,
  getErrorMessage,
} from "@keeper.sh/integration";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { OutlookAccount } from "./sync";
import { getOutlookAccountsForUser } from "./sync";

const MICROSOFT_GRAPH_API = "https://graph.microsoft.com/v1.0";
const OUTLOOK_PAGE_SIZE = 100;

const hasRateLimitMessage = (message: string | undefined): boolean => {
  if (!message) {
    return false;
  }
  return message.includes("429") || message.includes("throttled");
};

const isAuthError = (status: number, error: { code?: string } | undefined): boolean => {
  const code = error?.code;
  if (status === HTTP_STATUS.FORBIDDEN) {
    return code === "Authorization_RequestDenied" || code === "ErrorAccessDenied";
  }
  if (status === HTTP_STATUS.UNAUTHORIZED) {
    return code === "InvalidAuthenticationToken";
  }
  return false;
};

interface OutlookCalendarProviderConfig {
  database: BunSQLDatabase;
  oauthProvider: OAuthTokenProvider;
  broadcastSyncStatus?: BroadcastSyncStatus;
}

const createOutlookCalendarProvider = (
  config: OutlookCalendarProviderConfig,
): DestinationProvider => {
  const { database, oauthProvider, broadcastSyncStatus } = config;

  return createOAuthDestinationProvider<OutlookAccount, OutlookCalendarConfig>({
    broadcastSyncStatus,
    buildConfig: (db, account, broadcast) => ({
      accessToken: account.accessToken,
      accessTokenExpiresAt: account.accessTokenExpiresAt,
      accountId: account.accountId,
      broadcastSyncStatus: broadcast,
      database: db,
      destinationId: account.destinationId,
      refreshToken: account.refreshToken,
      userId: account.userId,
    }),
    createProviderInstance: (providerConfig, oauth) =>
      new OutlookCalendarProviderInstance(providerConfig, oauth),
    database,
    getAccountsForUser: getOutlookAccountsForUser,
    oauthProvider,
  });
};

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

    const today = getStartOfToday();

    do {
      const url = OutlookCalendarProviderInstance.buildListEventsUrl(today, options.until, nextLink);

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

  private static buildListEventsUrl(today: Date, until: Date, nextLink: string | null): URL {
    if (nextLink) {
      return new URL(nextLink);
    }

    const url = new URL(`${MICROSOFT_GRAPH_API}/me/calendar/events`);
    url.searchParams.set(
      "$filter",
      `categories/any(c:c eq '${KEEPER_CATEGORY}') and start/dateTime ge '${today.toISOString()}' and start/dateTime le '${until.toISOString()}'`,
    );
    url.searchParams.set("$top", String(OUTLOOK_PAGE_SIZE));
    url.searchParams.set("$select", "id,iCalUId,subject,start,end,categories");

    return url;
  }

  private static transformOutlookEvent(event: OutlookEvent): RemoteEvent | null {
    const startTime = OutlookCalendarProviderInstance.parseEventTime(event.start);
    const endTime = OutlookCalendarProviderInstance.parseEventTime(event.end);

    if (!event.id || !event.iCalUId || !startTime || !endTime) {
      return null;
    }

    return {
      deleteId: event.id,
      endTime,
      startTime,
      uid: event.iCalUId,
    };
  }

  protected async pushEvent(event: SyncableEvent): Promise<PushResult> {
    const resource = OutlookCalendarProviderInstance.toOutlookEvent(event);

    try {
      return await this.createEvent(resource);
    } catch (error) {
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

      return { success: true };
    } catch (error) {
      return {
        error: getErrorMessage(error),
        success: false,
      };
    }
  }

  private static parseEventTime(time: { dateTime?: string; timeZone?: string } | undefined): Date | null {
    if (!time?.dateTime) {
      return null;
    }

    if (time.timeZone === "UTC" && !time.dateTime.endsWith("Z")) {
      return new Date(`${time.dateTime}Z`);
    }

    return new Date(time.dateTime);
  }

  private static getBodyFromSyncableEvent(event: SyncableEvent): OutlookEvent["body"] {
    if (!event.description) {
      return null;
    }

    return {
      content: event.description,
      contentType: "text",
    }
  }

  private static toOutlookEvent(event: SyncableEvent): OutlookEvent {
    const body = OutlookCalendarProviderInstance.getBodyFromSyncableEvent(event);

    return {
      body,
      categories: [KEEPER_CATEGORY],
      end: { dateTime: event.endTime.toISOString(), timeZone: "UTC" },
      start: { dateTime: event.startTime.toISOString(), timeZone: "UTC" },
      subject: event.summary,
    };
  }
}

export { createOutlookCalendarProvider };
export type { OutlookCalendarProviderConfig };
