import {
  OAuthCalendarProvider,
  RateLimiter,
  getEventsForDestination,
  type OAuthTokenProvider,
  type DestinationProvider,
  type SyncableEvent,
  type PushResult,
  type DeleteResult,
  type RemoteEvent,
  type SyncResult,
  type OutlookCalendarConfig,
  type SyncContext,
  type ListRemoteEventsOptions,
  type BroadcastSyncStatus,
} from "@keeper.sh/integration";
import {
  outlookEventSchema,
  outlookEventListSchema,
  microsoftApiErrorSchema,
  type OutlookEvent,
} from "@keeper.sh/data-schemas";
import { HTTP_STATUS, KEEPER_CATEGORY } from "@keeper.sh/constants";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { getOutlookAccountsForUser } from "./sync";

const MICROSOFT_GRAPH_API = "https://graph.microsoft.com/v1.0";

const hasRateLimitMessage = (message: string | undefined): boolean => {
  if (!message) return false;
  return message.includes("429") || message.includes("throttled");
};

const isAuthError = (
  status: number,
  error: { code?: string } | undefined,
): boolean => {
  const code = error?.code;
  if (status === HTTP_STATUS.FORBIDDEN) {
    return (
      code === "Authorization_RequestDenied" || code === "ErrorAccessDenied"
    );
  }
  if (status === HTTP_STATUS.UNAUTHORIZED) {
    return code === "InvalidAuthenticationToken";
  }
  return false;
};

export interface OutlookCalendarProviderConfig {
  database: BunSQLDatabase;
  oauthProvider: OAuthTokenProvider;
  broadcastSyncStatus?: BroadcastSyncStatus;
}

export const createOutlookCalendarProvider = (
  config: OutlookCalendarProviderConfig,
): DestinationProvider => {
  const { database, oauthProvider, broadcastSyncStatus } = config;

  const syncForUser = async (
    userId: string,
    context: SyncContext,
  ): Promise<SyncResult | null> => {
    const outlookAccounts = await getOutlookAccountsForUser(database, userId);
    if (outlookAccounts.length === 0) return null;

    const results = await Promise.all(
      outlookAccounts.map(async (account) => {
        const localEvents = await getEventsForDestination(
          database,
          account.destinationId,
        );

        const provider = new OutlookCalendarProviderInstance(
          {
            database,
            destinationId: account.destinationId,
            userId: account.userId,
            accountId: account.accountId,
            accessToken: account.accessToken,
            refreshToken: account.refreshToken,
            accessTokenExpiresAt: account.accessTokenExpiresAt,
            broadcastSyncStatus,
          },
          oauthProvider,
        );
        return provider.sync(localEvents, context);
      }),
    );

    return results.reduce<SyncResult>(
      (combined, result) => ({
        added: combined.added + result.added,
        removed: combined.removed + result.removed,
      }),
      { added: 0, removed: 0 },
    );
  };

  return { syncForUser };
};

class OutlookCalendarProviderInstance extends OAuthCalendarProvider<OutlookCalendarConfig> {
  readonly name = "Outlook Calendar";
  readonly id = "outlook";

  protected oauthProvider: OAuthTokenProvider;
  private rateLimiter: RateLimiter;

  constructor(config: OutlookCalendarConfig, oauthProvider: OAuthTokenProvider) {
    super(config);
    this.rateLimiter = new RateLimiter(10);
    this.oauthProvider = oauthProvider;
  }

  async pushEvents(events: SyncableEvent[]): Promise<PushResult[]> {
    await this.ensureValidToken();

    const results = await Promise.all(
      events.map((event) =>
        this.rateLimiter.execute(async (): Promise<PushResult> => {
          const result = await this.pushEvent(event);
          if (!result.success && hasRateLimitMessage(result.error)) {
            this.rateLimiter.reportRateLimit();
          }
          return result;
        }),
      ),
    );

    return results;
  }

  async deleteEvents(eventIds: string[]): Promise<DeleteResult[]> {
    await this.ensureValidToken();

    const results = await Promise.all(
      eventIds.map((eventId) =>
        this.rateLimiter.execute(async (): Promise<DeleteResult> => {
          const result = await this.deleteEvent(eventId);
          if (!result.success && hasRateLimitMessage(result.error)) {
            this.rateLimiter.reportRateLimit();
          }
          return result;
        }),
      ),
    );

    return results;
  }

  async listRemoteEvents(
    options: ListRemoteEventsOptions,
  ): Promise<RemoteEvent[]> {
    await this.ensureValidToken();
    const remoteEvents: RemoteEvent[] = [];
    let nextLink: string | undefined;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    do {
      const url = nextLink
        ? new URL(nextLink)
        : new URL(`${MICROSOFT_GRAPH_API}/me/calendar/events`);

      if (!nextLink) {
        url.searchParams.set(
          "$filter",
          `categories/any(c:c eq '${KEEPER_CATEGORY}') and start/dateTime ge '${today.toISOString()}' and start/dateTime le '${options.until.toISOString()}'`,
        );
        url.searchParams.set("$top", "100");
        url.searchParams.set(
          "$select",
          "id,iCalUId,subject,start,end,categories",
        );
      }

      const response = await fetch(url, {
        method: "GET",
        headers: this.headers,
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
        const startTime = this.parseEventTime(event.start);
        const endTime = this.parseEventTime(event.end);

        if (event.id && event.iCalUId && startTime && endTime) {
          remoteEvents.push({
            uid: event.iCalUId,
            deleteId: event.id,
            startTime,
            endTime,
          });
        }
      }

      nextLink = data["@odata.nextLink"];
    } while (nextLink);

    return remoteEvents;
  }

  private async pushEvent(event: SyncableEvent): Promise<PushResult> {
    const resource = this.toOutlookEvent(event);

    try {
      return this.createEvent(resource);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private async createEvent(resource: OutlookEvent): Promise<PushResult> {
    const url = new URL(`${MICROSOFT_GRAPH_API}/me/calendar/events`);

    const response = await fetch(url, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(resource),
    });

    if (!response.ok) {
      const body = await response.json();
      const { error } = microsoftApiErrorSchema.assert(body);
      const errorMessage = error?.message ?? response.statusText;

      if (isAuthError(response.status, error)) {
        return this.handleAuthErrorResponse(errorMessage);
      }

      return { success: false, error: errorMessage };
    }

    const body = await response.json();
    const event = outlookEventSchema.assert(body);
    return { success: true, remoteId: event.iCalUId, deleteId: event.id };
  }

  private async deleteEvent(eventId: string): Promise<DeleteResult> {
    try {
      const url = new URL(`${MICROSOFT_GRAPH_API}/me/events/${eventId}`);

      const response = await fetch(url, {
        method: "DELETE",
        headers: this.headers,
      });

      if (!response.ok && response.status !== HTTP_STATUS.NOT_FOUND) {
        const body = await response.json();
        const { error } = microsoftApiErrorSchema.assert(body);
        const errorMessage = error?.message ?? response.statusText;

        if (isAuthError(response.status, error)) {
          return this.handleAuthErrorResponse(errorMessage);
        }

        return { success: false, error: errorMessage };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private parseEventTime(
    time: { dateTime?: string; timeZone?: string } | undefined,
  ): Date | null {
    if (!time?.dateTime) return null;

    if (time.timeZone === "UTC" && !time.dateTime.endsWith("Z")) {
      return new Date(time.dateTime + "Z");
    }

    return new Date(time.dateTime);
  }

  private toOutlookEvent(event: SyncableEvent): OutlookEvent {
    return {
      subject: event.summary,
      body: event.description
        ? { contentType: "text", content: event.description }
        : undefined,
      start: { dateTime: event.startTime.toISOString(), timeZone: "UTC" },
      end: { dateTime: event.endTime.toISOString(), timeZone: "UTC" },
      categories: [KEEPER_CATEGORY],
    };
  }
}
