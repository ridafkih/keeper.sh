import {
  CalendarProvider,
  RateLimiter,
  getEventsForDestination,
  type DestinationProvider,
  type SyncableEvent,
  type PushResult,
  type DeleteResult,
  type RemoteEvent,
  type SyncResult,
  type GoogleCalendarConfig,
  type SyncContext,
  type ListRemoteEventsOptions,
  type BroadcastSyncStatus,
} from "@keeper.sh/integrations";
import {
  googleEventSchema,
  googleEventListSchema,
  googleApiErrorSchema,
  type GoogleEvent,
} from "@keeper.sh/data-schemas";
import {
  oauthCredentialsTable,
  calendarDestinationsTable,
} from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { getGoogleAccountsForUser } from "./sync";

const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3/";
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

const isRateLimitError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("429") || error.message.includes("rateLimitExceeded")
  );
};

const isAuthError = (
  status: number,
  error: { code?: number; status?: string } | undefined,
): boolean => {
  if (status === 403 && error?.status === "PERMISSION_DENIED") return true;
  if (status === 401 && error?.status === "UNAUTHENTICATED") return true;
  return false;
};

export interface OAuthProvider {
  refreshAccessToken: (
    refreshToken: string,
  ) => Promise<{ access_token: string; expires_in: number }>;
}

export interface GoogleCalendarProviderConfig {
  database: BunSQLDatabase;
  oauthProvider: OAuthProvider;
  broadcastSyncStatus?: BroadcastSyncStatus;
}

export const createGoogleCalendarProvider = (
  config: GoogleCalendarProviderConfig,
): DestinationProvider => {
  const { database, oauthProvider, broadcastSyncStatus } = config;

  const syncForUser = async (
    userId: string,
    context: SyncContext,
  ): Promise<SyncResult | null> => {
    const googleAccounts = await getGoogleAccountsForUser(database, userId);
    if (googleAccounts.length === 0) return null;

    const results = await Promise.all(
      googleAccounts.map(async (account) => {
        const localEvents = await getEventsForDestination(
          database,
          account.destinationId,
        );

        const provider = new GoogleCalendarProviderInstance(
          {
            database,
            destinationId: account.destinationId,
            userId: account.userId,
            accountId: account.accountId,
            accessToken: account.accessToken,
            refreshToken: account.refreshToken,
            accessTokenExpiresAt: account.accessTokenExpiresAt,
            calendarId: "primary",
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

class GoogleCalendarProviderInstance extends CalendarProvider<GoogleCalendarConfig> {
  readonly name = "Google Calendar";
  readonly id = "google";

  private currentAccessToken: string;
  private rateLimiter: RateLimiter;
  private oauthProvider: OAuthProvider;

  constructor(config: GoogleCalendarConfig, oauthProvider: OAuthProvider) {
    super(config);
    this.currentAccessToken = config.accessToken;
    this.rateLimiter = new RateLimiter(10);
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
    await database
      .update(calendarDestinationsTable)
      .set({ needsReauthentication: true })
      .where(eq(calendarDestinationsTable.id, destinationId));

    broadcastSyncStatus?.(userId, destinationId, { needsReauthentication: true });
  }

  private async ensureValidToken(): Promise<void> {
    const { database, accessTokenExpiresAt, refreshToken, accountId } =
      this.config;

    if (accessTokenExpiresAt.getTime() > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      return;
    }

    const tokenData = await this.oauthProvider.refreshAccessToken(refreshToken);
    const newExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

    const [destination] = await database
      .select({
        oauthCredentialId: calendarDestinationsTable.oauthCredentialId,
      })
      .from(calendarDestinationsTable)
      .where(eq(calendarDestinationsTable.accountId, accountId))
      .limit(1);

    if (destination?.oauthCredentialId) {
      await database
        .update(oauthCredentialsTable)
        .set({
          accessToken: tokenData.access_token,
          expiresAt: newExpiresAt,
        })
        .where(eq(oauthCredentialsTable.id, destination.oauthCredentialId));
    }

    this.currentAccessToken = tokenData.access_token;
    this.config.accessTokenExpiresAt = newExpiresAt;
  }

  async pushEvents(events: SyncableEvent[]): Promise<PushResult[]> {
    await this.ensureValidToken();

    const results = await Promise.all(
      events.map((event) =>
        this.rateLimiter.execute(async (): Promise<PushResult> => {
          const result = await this.pushEvent(event);
          if (!result.success && isRateLimitError(new Error(result.error))) {
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
          if (!result.success && isRateLimitError(new Error(result.error))) {
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

    let pageToken: string | undefined;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    do {
      const url = new URL(
        `calendars/${encodeURIComponent(this.config.calendarId)}/events`,
        GOOGLE_CALENDAR_API,
      );

      url.searchParams.set("maxResults", "2500");
      url.searchParams.set("timeMin", today.toISOString());
      url.searchParams.set("timeMax", options.until.toISOString());
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const response = await fetch(url, {
        method: "GET",
        headers: this.headers,
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
        if (event.iCalUID && this.isKeeperEvent(event.iCalUID)) {
          const startTime = this.parseEventTime(event.start);
          const endTime = this.parseEventTime(event.end);

          if (startTime && endTime) {
            remoteEvents.push({
              uid: event.iCalUID,
              deleteId: event.iCalUID,
              startTime,
              endTime,
            });
          }
        }
      }

      pageToken = data.nextPageToken;
    } while (pageToken);

    return remoteEvents;
  }

  private async pushEvent(event: SyncableEvent): Promise<PushResult> {
    const uid = this.generateUid();
    const resource = this.toGoogleEvent(event, uid);

    try {
      const result = await this.createEvent(resource);
      if (result.success) {
        return { success: true, remoteId: uid };
      }
      return result;
    } catch {
      return { success: false, error: "Failed to push event" };
    }
  }

  private async createEvent(resource: GoogleEvent): Promise<PushResult> {
    const url = new URL(
      `calendars/${encodeURIComponent(this.config.calendarId)}/events`,
      GOOGLE_CALENDAR_API,
    );

    const response = await fetch(url, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(resource),
    });

    if (!response.ok) {
      const body = await response.json();
      const { error } = googleApiErrorSchema.assert(body);

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

    await response.json();
    return { success: true };
  }

  private async deleteEvent(uid: string): Promise<DeleteResult> {
    try {
      const existing = await this.findEventByUid(uid);

      if (!existing?.id) {
        return { success: true };
      }

      const url = new URL(
        `calendars/${encodeURIComponent(this.config.calendarId)}/events/${encodeURIComponent(existing.id)}`,
        GOOGLE_CALENDAR_API,
      );

      const response = await fetch(url, {
        method: "DELETE",
        headers: this.headers,
      });

      if (!response.ok && response.status !== 404) {
        const body = await response.json();
        const { error } = googleApiErrorSchema.assert(body);

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

      return { success: true };
    } catch {
      return { success: false, error: "Failed to delete event" };
    }
  }

  private async findEventByUid(uid: string): Promise<GoogleEvent | null> {
    const url = new URL(
      `calendars/${encodeURIComponent(this.config.calendarId)}/events`,
      GOOGLE_CALENDAR_API,
    );

    url.searchParams.set("iCalUID", uid);

    const response = await fetch(url, {
      method: "GET",
      headers: this.headers,
    });

    if (!response.ok) {
      return null;
    }

    const body = await response.json();
    const { items } = googleEventListSchema.assert(body);
    const [item] = items ?? [];
    return item ?? null;
  }

  private parseEventTime(
    time: { dateTime?: string; date?: string } | undefined,
  ): Date | null {
    if (time?.dateTime) return new Date(time.dateTime);
    if (time?.date) return new Date(time.date);
    return null;
  }

  private toGoogleEvent(event: SyncableEvent, uid: string): GoogleEvent {
    return {
      iCalUID: uid,
      summary: event.summary,
      description: event.description,
      start: { dateTime: event.startTime.toISOString() },
      end: { dateTime: event.endTime.toISOString() },
    };
  }
}
