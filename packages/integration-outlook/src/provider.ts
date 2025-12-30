import {
  CalendarProvider,
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
} from "@keeper.sh/integrations";
import {
  outlookEventSchema,
  outlookEventListSchema,
  microsoftApiErrorSchema,
  type OutlookEvent,
} from "@keeper.sh/data-schemas";
import {
  oauthCredentialsTable,
  calendarDestinationsTable,
} from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { getOutlookAccountsForUser, getUserEvents } from "./sync";

const MICROSOFT_GRAPH_API = "https://graph.microsoft.com/v1.0";
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const RATE_LIMIT_DELAY_MS = 60_000;
const KEEPER_CATEGORY = "keeper.sh";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRateLimitError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  return error.message.includes("429") || error.message.includes("throttled");
};

const isAuthError = (
  status: number,
  error: { code?: string } | undefined,
): boolean => {
  const code = error?.code;
  if (status === 403) {
    return code === "Authorization_RequestDenied" || code === "ErrorAccessDenied";
  }
  if (status === 401) {
    return code === "InvalidAuthenticationToken";
  }
  return false;
};

export interface OAuthProvider {
  refreshAccessToken: (refreshToken: string) => Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  }>;
}

export interface OutlookCalendarProviderConfig {
  database: BunSQLDatabase;
  oauthProvider: OAuthProvider;
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

    const localEvents = await getUserEvents(database, userId);

    const results = await Promise.all(
      outlookAccounts.map((account) => {
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

class OutlookCalendarProviderInstance extends CalendarProvider<OutlookCalendarConfig> {
  readonly name = "Outlook Calendar";
  readonly id = "outlook";

  private currentAccessToken: string;
  private oauthProvider: OAuthProvider;

  constructor(config: OutlookCalendarConfig, oauthProvider: OAuthProvider) {
    super(config);
    this.currentAccessToken = config.accessToken;
    this.oauthProvider = oauthProvider;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.currentAccessToken}`,
      "Content-Type": "application/json",
    };
  }

  private async markNeedsReauthentication(): Promise<void> {
    const { database, destinationId, userId, broadcastSyncStatus } = this.config;
    this.childLog.warn({ destinationId }, "marking destination as needing reauthentication");
    await database
      .update(calendarDestinationsTable)
      .set({ needsReauthentication: true })
      .where(eq(calendarDestinationsTable.id, destinationId));

    broadcastSyncStatus?.(userId, destinationId, { needsReauthentication: true });
  }

  private async ensureValidToken(): Promise<void> {
    const { database, accessTokenExpiresAt, refreshToken, accountId, destinationId } =
      this.config;

    if (accessTokenExpiresAt.getTime() > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      return;
    }

    this.childLog.info({ accountId }, "refreshing token");

    const tokenData = await this.oauthProvider.refreshAccessToken(refreshToken);
    const newExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

    const [destination] = await database
      .select({
        oauthCredentialId: calendarDestinationsTable.oauthCredentialId,
      })
      .from(calendarDestinationsTable)
      .where(eq(calendarDestinationsTable.id, destinationId))
      .limit(1);

    if (destination?.oauthCredentialId) {
      this.childLog.debug({ accountId }, "updating database with new token");
      await database
        .update(oauthCredentialsTable)
        .set({
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token ?? refreshToken,
          expiresAt: newExpiresAt,
        })
        .where(eq(oauthCredentialsTable.id, destination.oauthCredentialId));
    }

    this.currentAccessToken = tokenData.access_token;
    this.config.accessTokenExpiresAt = newExpiresAt;

    this.childLog.debug({ accountId }, "token refreshed");
  }

  async pushEvents(events: SyncableEvent[]): Promise<PushResult[]> {
    await this.ensureValidToken();
    this.childLog.info({ count: events.length }, "pushing events");

    const results: PushResult[] = [];

    for (const event of events) {
      const result = await this.pushEvent(event);
      results.push(result);

      if (!result.success && isRateLimitError(new Error(result.error))) {
        this.childLog.warn("rate limit hit, waiting before continuing");
        await delay(RATE_LIMIT_DELAY_MS);
      }
    }

    const succeeded = results.filter(({ success }) => success).length;
    this.childLog.info(
      { succeeded, failed: results.length - succeeded },
      "push complete",
    );
    return results;
  }

  async deleteEvents(eventIds: string[]): Promise<DeleteResult[]> {
    await this.ensureValidToken();
    this.childLog.info({ count: eventIds.length }, "deleting events");

    const results: DeleteResult[] = [];

    for (const eventId of eventIds) {
      const result = await this.deleteEvent(eventId);
      results.push(result);

      if (!result.success && isRateLimitError(new Error(result.error))) {
        this.childLog.warn("rate limit hit, waiting before continuing");
        await delay(RATE_LIMIT_DELAY_MS);
      }
    }

    const succeeded = results.filter(({ success }) => success).length;
    this.childLog.info(
      { succeeded, failed: results.length - succeeded },
      "delete complete",
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
        this.childLog.error(
          { status: response.status, error },
          "failed to list events",
        );

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

    this.childLog.debug({ count: remoteEvents.length }, "listed remote events");
    return remoteEvents;
  }

  private async pushEvent(event: SyncableEvent): Promise<PushResult> {
    const resource = this.toOutlookEvent(event);

    try {
      return this.createEvent(resource);
    } catch (error) {
      this.childLog.error({ error }, "failed to push event");
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
      this.childLog.error(
        { status: response.status, error },
        "create event failed",
      );

      if (isAuthError(response.status, error)) {
        await this.markNeedsReauthentication();
        return {
          success: false,
          error: error?.message ?? response.statusText,
          shouldContinue: false,
        };
      }

      return {
        success: false,
        error: error?.message ?? response.statusText,
      };
    }

    const body = await response.json();
    const event = outlookEventSchema.assert(body);
    this.childLog.debug({ remoteId: event.iCalUId }, "event created");
    return { success: true, remoteId: event.iCalUId, deleteId: event.id };
  }

  private async deleteEvent(eventId: string): Promise<DeleteResult> {
    try {
      const url = new URL(`${MICROSOFT_GRAPH_API}/me/events/${eventId}`);

      const response = await fetch(url, {
        method: "DELETE",
        headers: this.headers,
      });

      if (!response.ok && response.status !== 404) {
        const body = await response.json();
        const { error } = microsoftApiErrorSchema.assert(body);
        this.childLog.error(
          { status: response.status, eventId, error },
          "delete event failed",
        );

        if (isAuthError(response.status, error)) {
          await this.markNeedsReauthentication();
          return {
            success: false,
            error: error?.message ?? response.statusText,
            shouldContinue: false,
          };
        }

        return {
          success: false,
          error: error?.message ?? response.statusText,
        };
      }

      this.childLog.debug({ eventId }, "event deleted");
      return { success: true };
    } catch (error) {
      this.childLog.error({ eventId, error }, "failed to delete event");
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
