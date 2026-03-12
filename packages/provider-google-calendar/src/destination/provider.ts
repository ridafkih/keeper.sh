import {
  OAuthCalendarProvider,
  createOAuthDestinationProvider,
  generateEventUid,
  getErrorMessage,
  getOAuthSyncWindowStart,
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
  RefreshLockStore,
  RemoteEvent,
  SyncableEvent,
} from "@keeper.sh/provider-core";
import { googleApiErrorSchema, googleEventListSchema } from "@keeper.sh/data-schemas";
import type { GoogleEvent } from "@keeper.sh/data-schemas";
import { HTTP_STATUS } from "@keeper.sh/constants";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { widelog } from "widelogger";
import { GOOGLE_CALENDAR_API, GOOGLE_CALENDAR_MAX_RESULTS } from "../shared/api";
import { hasRateLimitMessage, isAuthError } from "../shared/errors";
import { parseEventTime } from "../shared/date-time";
import { canSerializeGoogleEvent, serializeGoogleEvent } from "./serialize-event";
import { getGoogleAccountsForUser } from "./sync";
import type { GoogleAccount } from "./sync";

const formatByDayValue = (value: { day: string; occurrence?: number }): string => {
  if (value.occurrence) {
    return `${value.occurrence}${value.day}`;
  }
  return value.day;
};

interface GoogleCalendarProviderConfig {
  database: BunSQLDatabase;
  oauthProvider: OAuthTokenProvider;
  broadcastSyncStatus?: BroadcastSyncStatus;
  refreshLockStore?: RefreshLockStore | null;
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
        GoogleCalendarProviderInstance.buildRecurrenceRule(event),
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

  private static formatRecurrenceDate(value: Date | string): string {
    if (value instanceof Date) {
      return value.toISOString().replaceAll(/[-:]/g, "").replace(/\.\d{3}/, "");
    }
    return new Date(value).toISOString().replaceAll(/[-:]/g, "").replace(/\.\d{3}/, "");
  }

  private static isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  private static parseNumberArray(value: unknown): number[] | void {
    if (!Array.isArray(value)) {
      return;
    }

    if (value.some((entry) => typeof entry !== "number")) {
      return;
    }

    return value;
  }

  private static parseByDay(value: unknown): { day: string; occurrence?: number }[] | void {
    if (!Array.isArray(value)) {
      return;
    }

    const parsedByDay: { day: string; occurrence?: number }[] = [];

    for (const entry of value) {
      if (!GoogleCalendarProviderInstance.isRecord(entry)) {
        continue;
      }

      if (typeof entry.day !== "string") {
        continue;
      }

      if ("occurrence" in entry && typeof entry.occurrence !== "number") {
        continue;
      }

      if (typeof entry.occurrence === "number") {
        parsedByDay.push({ day: entry.day, occurrence: entry.occurrence });
        continue;
      }

      parsedByDay.push({ day: entry.day });
    }

    if (parsedByDay.length === 0) {
      return;
    }
    return parsedByDay;
  }

  private static pushNumberArrayPart(
    parts: string[],
    key: string,
    value: unknown,
  ): void {
    const parsed = GoogleCalendarProviderInstance.parseNumberArray(value);
    if (parsed?.length) {
      parts.push(`${key}=${parsed.join(",")}`);
    }
  }

  private static buildRecurrenceRule(event: SyncableEvent): string | null {
    const { recurrenceRule } = event;
    if (!GoogleCalendarProviderInstance.isRecord(recurrenceRule)) {
      return null;
    }

    if (typeof recurrenceRule.frequency !== "string") {
      return null;
    }

    const parts: string[] = [`FREQ=${recurrenceRule.frequency}`];

    if (typeof recurrenceRule.interval === "number") {
      parts.push(`INTERVAL=${recurrenceRule.interval}`);
    }
    if (typeof recurrenceRule.count === "number") {
      parts.push(`COUNT=${recurrenceRule.count}`);
    }

    if (GoogleCalendarProviderInstance.isRecord(recurrenceRule.until)) {
      const untilDate = recurrenceRule.until.date;
      if (untilDate instanceof Date || typeof untilDate === "string") {
        parts.push(`UNTIL=${GoogleCalendarProviderInstance.formatRecurrenceDate(untilDate)}`);
      }
    }

    const byDay = GoogleCalendarProviderInstance.parseByDay(recurrenceRule.byDay);
    if (byDay?.length) {
      parts.push(`BYDAY=${byDay.map((value) => formatByDayValue(value)).join(",")}`);
    }

    GoogleCalendarProviderInstance.pushNumberArrayPart(parts, "BYMONTH", recurrenceRule.byMonth);
    GoogleCalendarProviderInstance.pushNumberArrayPart(parts, "BYMONTHDAY", recurrenceRule.byMonthday);
    GoogleCalendarProviderInstance.pushNumberArrayPart(parts, "BYSETPOS", recurrenceRule.bySetPos);
    GoogleCalendarProviderInstance.pushNumberArrayPart(parts, "BYYEARDAY", recurrenceRule.byYearday);
    GoogleCalendarProviderInstance.pushNumberArrayPart(parts, "BYWEEKNO", recurrenceRule.byWeekNo);
    GoogleCalendarProviderInstance.pushNumberArrayPart(parts, "BYHOUR", recurrenceRule.byHour);
    GoogleCalendarProviderInstance.pushNumberArrayPart(parts, "BYMINUTE", recurrenceRule.byMinute);
    GoogleCalendarProviderInstance.pushNumberArrayPart(parts, "BYSECOND", recurrenceRule.bySecond);

    if (typeof recurrenceRule.workweekStart === "string") {
      parts.push(`WKST=${recurrenceRule.workweekStart}`);
    }

    return parts.join(";");
  }
}

export { createGoogleCalendarProvider };
export type { GoogleCalendarProviderConfig };
