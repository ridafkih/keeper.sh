import {
  OAuthCalendarProvider,
  createOAuthDestinationProvider,
  generateEventUid,
  getErrorMessage,
  isKeeperEvent,
} from "@keeper.sh/provider-core";
import type {
  BroadcastSyncStatus,
  DeleteResult,
  DestinationProvider,
  GoogleCalendarConfig,
  ListRemoteEventsOptions,
  OAuthTokenProvider,
  PushResult,
  RemoteEvent,
  SyncableEvent,
} from "@keeper.sh/provider-core";
import { WideEvent } from "@keeper.sh/log";
import { googleApiErrorSchema, googleEventListSchema } from "@keeper.sh/data-schemas";
import type { GoogleEvent } from "@keeper.sh/data-schemas";
import { HTTP_STATUS } from "@keeper.sh/constants";
import { getStartOfToday } from "@keeper.sh/date-utils";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { GOOGLE_CALENDAR_API, GOOGLE_CALENDAR_MAX_RESULTS } from "../shared/api";
import { hasRateLimitMessage, isAuthError } from "../shared/errors";
import { parseEventTime } from "../shared/date-time";
import { getGoogleAccountsForUser } from "./sync";
import type { GoogleAccount } from "./sync";

interface GoogleCalendarProviderConfig {
  database: BunSQLDatabase;
  oauthProvider: OAuthTokenProvider;
  broadcastSyncStatus?: BroadcastSyncStatus;
}

const createGoogleCalendarProvider = (
  config: GoogleCalendarProviderConfig,
): DestinationProvider => {
  const { database, oauthProvider, broadcastSyncStatus } = config;

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
  });
};

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
    const today = getStartOfToday();

    do {
      const url = this.buildListEventsUrl(today, options.until, pageToken);

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

  private buildListEventsUrl(today: Date, until: Date, pageToken: string | null): URL {
    const url = new URL(
      `calendars/${encodeURIComponent(this.config.externalCalendarId)}/events`,
      GOOGLE_CALENDAR_API,
    );

    url.searchParams.set("maxResults", String(GOOGLE_CALENDAR_MAX_RESULTS));
    url.searchParams.set("timeMin", today.toISOString());
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
    const uid = generateEventUid();
    const resource = GoogleCalendarProviderInstance.toGoogleEvent(event, uid);

    try {
      const result = await this.createEvent(resource);
      if (result.success) {
        return { remoteId: uid, success: true };
      }
      return result;
    } catch (error) {
      WideEvent.error(error);
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
      WideEvent.error(error);
      return { error: getErrorMessage(error), success: false };
    }
  }

  private async findEventByUid(uid: string): Promise<GoogleEvent | null> {
    const event = WideEvent.grasp();
    event?.startTiming("findEventByUid");

    const url = new URL(
      `calendars/${encodeURIComponent(this.config.externalCalendarId)}/events`,
      GOOGLE_CALENDAR_API,
    );

    url.searchParams.set("iCalUID", uid);

    const response = await fetch(url, {
      headers: this.headers,
      method: "GET",
    });

    event?.endTiming("findEventByUid");

    if (!response.ok) {
      await response.body?.cancel?.();
      event?.set({ "find_event_by_uid.status": response.status });
      return null;
    }

    const body = await response.json();
    const { items } = googleEventListSchema.assert(body);
    const [item] = items ?? [];
    return item ?? null;
  }

  private static formatRecurrenceDate(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value);
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  }

  private static isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  private static parseNumberArray(value: unknown): number[] | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }

    if (value.some((entry) => typeof entry !== "number")) {
      return undefined;
    }

    return value;
  }

  private static parseByDay(value: unknown): Array<{ day: string; occurrence?: number }> | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }

    const parsedByDay: Array<{ day: string; occurrence?: number }> = [];

    for (const entry of value) {
      if (!GoogleCalendarProviderInstance.isRecord(entry)) {
        continue;
      }

      if (typeof entry.day !== "string") {
        continue;
      }

      if (entry.occurrence !== undefined && typeof entry.occurrence !== "number") {
        continue;
      }

      if (typeof entry.occurrence === "number") {
        parsedByDay.push({ day: entry.day, occurrence: entry.occurrence });
        continue;
      }

      parsedByDay.push({ day: entry.day });
    }

    return parsedByDay.length > 0 ? parsedByDay : undefined;
  }

  private static buildRecurrenceRule(event: SyncableEvent): string | null {
    const { recurrenceRule } = event;
    if (!GoogleCalendarProviderInstance.isRecord(recurrenceRule)) {
      return null;
    }

    if (typeof recurrenceRule.frequency !== "string") {
      return null;
    }

    const recurrenceParts: string[] = [`FREQ=${recurrenceRule.frequency}`];

    if (typeof recurrenceRule.interval === "number") {
      recurrenceParts.push(`INTERVAL=${recurrenceRule.interval}`);
    }
    if (typeof recurrenceRule.count === "number") {
      recurrenceParts.push(`COUNT=${recurrenceRule.count}`);
    }

    if (GoogleCalendarProviderInstance.isRecord(recurrenceRule.until)) {
      const untilDate = recurrenceRule.until.date;
      if (untilDate instanceof Date || typeof untilDate === "string") {
        recurrenceParts.push(
          `UNTIL=${GoogleCalendarProviderInstance.formatRecurrenceDate(untilDate)}`,
        );
      }
    }

    const byDay = GoogleCalendarProviderInstance.parseByDay(recurrenceRule.byDay);
    if (byDay?.length) {
      const byDayValues = byDay.map((value) =>
        value.occurrence ? `${value.occurrence}${value.day}` : value.day,
      );
      recurrenceParts.push(`BYDAY=${byDayValues.join(",")}`);
    }

    const byMonth = GoogleCalendarProviderInstance.parseNumberArray(recurrenceRule.byMonth);
    if (byMonth?.length) {
      recurrenceParts.push(`BYMONTH=${byMonth.join(",")}`);
    }

    const byMonthday = GoogleCalendarProviderInstance.parseNumberArray(
      recurrenceRule.byMonthday,
    );
    if (byMonthday?.length) {
      recurrenceParts.push(`BYMONTHDAY=${byMonthday.join(",")}`);
    }

    const bySetPos = GoogleCalendarProviderInstance.parseNumberArray(recurrenceRule.bySetPos);
    if (bySetPos?.length) {
      recurrenceParts.push(`BYSETPOS=${bySetPos.join(",")}`);
    }

    const byYearday = GoogleCalendarProviderInstance.parseNumberArray(
      recurrenceRule.byYearday,
    );
    if (byYearday?.length) {
      recurrenceParts.push(`BYYEARDAY=${byYearday.join(",")}`);
    }

    const byWeekNo = GoogleCalendarProviderInstance.parseNumberArray(recurrenceRule.byWeekNo);
    if (byWeekNo?.length) {
      recurrenceParts.push(`BYWEEKNO=${byWeekNo.join(",")}`);
    }

    const byHour = GoogleCalendarProviderInstance.parseNumberArray(recurrenceRule.byHour);
    if (byHour?.length) {
      recurrenceParts.push(`BYHOUR=${byHour.join(",")}`);
    }

    const byMinute = GoogleCalendarProviderInstance.parseNumberArray(recurrenceRule.byMinute);
    if (byMinute?.length) {
      recurrenceParts.push(`BYMINUTE=${byMinute.join(",")}`);
    }

    const bySecond = GoogleCalendarProviderInstance.parseNumberArray(recurrenceRule.bySecond);
    if (bySecond?.length) {
      recurrenceParts.push(`BYSECOND=${bySecond.join(",")}`);
    }

    if (typeof recurrenceRule.workweekStart === "string") {
      recurrenceParts.push(
        `WKST=${recurrenceRule.workweekStart}`,
      );
    }

    return recurrenceParts.join(";");
  }

  private static toGoogleEvent(event: SyncableEvent, uid: string): GoogleEvent {
    const recurrenceRule = GoogleCalendarProviderInstance.buildRecurrenceRule(event);
    const recurrenceTimeZone = event.startTimeZone ?? "UTC";

    const googleEvent: GoogleEvent = {
      description: event.description,
      end: {
        dateTime: event.endTime.toISOString(),
        ...(recurrenceRule && { timeZone: recurrenceTimeZone }),
      },
      iCalUID: uid,
      location: event.location,
      start: {
        dateTime: event.startTime.toISOString(),
        ...(recurrenceRule && { timeZone: recurrenceTimeZone }),
      },
      summary: event.summary,
    };

    if (recurrenceRule) {
      googleEvent.recurrence = [`RRULE:${recurrenceRule}`];
    }

    return googleEvent;
  }
}

export { createGoogleCalendarProvider };
export type { GoogleCalendarProviderConfig };
