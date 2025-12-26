import {
  CalendarProvider,
  type SyncableEvent,
  type PushResult,
  type DeleteResult,
  type RemoteEvent,
  type SyncResult,
  type GoogleCalendarConfig,
  type SyncContext,
} from "@keeper.sh/integrations";
import {
  googleEventSchema,
  googleEventListSchema,
  googleApiErrorSchema,
  type GoogleEvent,
} from "@keeper.sh/data-schemas";
import { database } from "@keeper.sh/database";
import { calendarDestinationsTable } from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import { refreshAccessToken } from "@keeper.sh/oauth-google";
import { getGoogleAccountForUser, getUserEvents } from "./sync";

const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3/";
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const RATE_LIMIT_DELAY_MS = 60_000;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRateLimitError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("429") || error.message.includes("rateLimitExceeded")
  );
};

export class GoogleCalendarProvider extends CalendarProvider<GoogleCalendarConfig> {
  readonly name = "Google Calendar";
  readonly id = "google";

  private currentAccessToken: string;

  constructor(config: GoogleCalendarConfig) {
    super(config);
    this.currentAccessToken = config.accessToken;
  }

  static async syncForUser(userId: string, context: SyncContext): Promise<SyncResult | null> {
    const googleAccount = await getGoogleAccountForUser(userId);
    if (!googleAccount) return null;

    const provider = new GoogleCalendarProvider({
      userId: googleAccount.userId,
      accountId: googleAccount.accountId,
      accessToken: googleAccount.accessToken,
      refreshToken: googleAccount.refreshToken,
      accessTokenExpiresAt: googleAccount.accessTokenExpiresAt,
      calendarId: "primary",
    });

    const localEvents = await getUserEvents(userId);
    return provider.sync(localEvents, context);
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.currentAccessToken}`,
      "Content-Type": "application/json",
    };
  }

  private async ensureValidToken(): Promise<void> {
    const { accessTokenExpiresAt, refreshToken, accountId } = this.config;

    if (accessTokenExpiresAt.getTime() > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      return;
    }

    this.childLog.info({ accountId }, "refreshing token");

    const tokenData = await refreshAccessToken(refreshToken);
    const newExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

    this.childLog.debug({ accountId }, "updating database with new token");
    await database
      .update(calendarDestinationsTable)
      .set({
        accessToken: tokenData.access_token,
        accessTokenExpiresAt: newExpiresAt,
        updatedAt: new Date(),
      })
      .where(eq(calendarDestinationsTable.accountId, accountId));

    this.currentAccessToken = tokenData.access_token;
    this.config.accessTokenExpiresAt = newExpiresAt;

    this.childLog.debug({ accountId }, "token refreshed");
  }

  async pushEvents(events: SyncableEvent[]): Promise<PushResult[]> {
    await this.ensureValidToken();
    this.childLog.info(
      { count: events.length, calendarId: this.config.calendarId },
      "pushing events",
    );

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
    this.childLog.info(
      { count: eventIds.length, calendarId: this.config.calendarId },
      "deleting events",
    );

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

  async listRemoteEvents(): Promise<RemoteEvent[]> {
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
        this.childLog.error(
          { status: response.status, error },
          "failed to list events",
        );
        throw new Error(error?.message ?? response.statusText);
      }

      const body = await response.json();
      const data = googleEventListSchema.assert(body);

      for (const event of data.items ?? []) {
        if (event.iCalUID && this.isKeeperEvent(event.iCalUID)) {
          const startTime = this.parseEventTime(event.start);
          const endTime = this.parseEventTime(event.end);

          if (startTime && endTime) {
            remoteEvents.push({ uid: event.iCalUID, startTime, endTime });
          }
        }
      }

      pageToken = data.nextPageToken;
    } while (pageToken);

    this.childLog.debug({ count: remoteEvents.length }, "listed remote events");
    return remoteEvents;
  }

  private async pushEvent(event: SyncableEvent): Promise<PushResult> {
    const uid = this.generateUid();
    const resource = this.toGoogleEvent(event, uid);

    try {
      this.childLog.debug({ uid }, "creating event");
      return this.createEvent(resource);
    } catch (error) {
      this.childLog.error({ uid, error }, "failed to push event");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
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
      this.childLog.error(
        { status: response.status, error },
        "create event failed",
      );
      return {
        success: false,
        error: error?.message ?? response.statusText,
      };
    }

    const body = await response.json();
    const { id: remoteId } = googleEventSchema.assert(body);
    this.childLog.debug({ remoteId }, "event created");
    return { success: true, remoteId };
  }

  private async deleteEvent(uid: string): Promise<DeleteResult> {
    try {
      const existing = await this.findEventByUid(uid);

      if (!existing?.id) {
        this.childLog.debug({ uid }, "event not found, skipping delete");
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
        this.childLog.error(
          { status: response.status, uid, error },
          "delete event failed",
        );
        return {
          success: false,
          error: error?.message ?? response.statusText,
        };
      }

      this.childLog.debug({ uid, eventId: existing.id }, "event deleted");
      return { success: true };
    } catch (error) {
      this.childLog.error({ uid, error }, "failed to delete event");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
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
      this.childLog.warn(
        { status: response.status, uid },
        "failed to find event by uid",
      );
      return null;
    }

    const body = await response.json();
    const { items } = googleEventListSchema.assert(body);
    return items?.[0] ?? null;
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
