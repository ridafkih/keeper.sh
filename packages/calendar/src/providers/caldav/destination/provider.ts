import{ CalendarProvider } from "../../../core/sync/provider";
import{ RateLimiter } from "../../../core/utils/rate-limiter";
import{ generateEventUid, isKeeperEvent } from "../../../core/events/identity";
import{ getErrorMessage } from "../../../core/utils/error";
import{ getEventsForDestination } from "../../../core/events/events";
import type{ CalDAVConfig, DeleteResult, PushResult, RemoteEvent, SyncResult, SyncableEvent } from "../../../core/types";
import type{ DestinationProvider } from "../../../core/sync/destinations";
import type{ SyncContext } from "../../../core/sync/coordinator";
import type { CalDAVProviderConfig, CalDAVProviderOptions } from "../types";
import { widelog } from "widelogger";
import { CalDAVClient } from "../shared/client";
import { eventToICalString, parseICalToRemoteEvent } from "../shared/ics";
import { getCalDAVSyncWindow } from "../shared/sync-window";
import { createCalDAVService } from "./sync";

const EMPTY_ACCOUNTS_COUNT = 0;
const INITIAL_ADDED_COUNT = 0;
const INITIAL_ADD_FAILED_COUNT = 0;
const INITIAL_REMOVED_COUNT = 0;
const INITIAL_REMOVE_FAILED_COUNT = 0;
const CALDAV_RATE_LIMIT_CONCURRENCY = 5;
const YEARS_UNTIL_FUTURE = 2;

const DEFAULT_CALDAV_OPTIONS: CalDAVProviderOptions = {
  providerId: "caldav",
  providerName: "CalDAV",
};

class CalDAVProviderInstance extends CalendarProvider<CalDAVConfig> {
  readonly name: string;
  readonly id: string;

  private client: CalDAVClient;
  private rateLimiter: RateLimiter;

  constructor(
    config: CalDAVConfig,
    password: string,
    options: CalDAVProviderOptions = DEFAULT_CALDAV_OPTIONS,
  ) {
    super(config);
    this.id = options.providerId;
    this.name = options.providerName;
    this.client = new CalDAVClient({
      credentials: {
        password,
        username: config.username,
      },
      serverUrl: config.serverUrl,
    });

    this.rateLimiter = new RateLimiter({ concurrency: CALDAV_RATE_LIMIT_CONCURRENCY });
  }

  pushEvents(events: SyncableEvent[]): Promise<PushResult[]> {
    return Promise.all(
      events.map((event) =>
        this.rateLimiter.execute(async (): Promise<PushResult> => {
          widelog.set("destination.calendar_id", this.config.calendarId);
          widelog.set("operation.name", "caldav:push");
          widelog.set("source.provider", this.id);
          widelog.set("user.id", this.config.userId);

          try {
            const uid = generateEventUid();
            const iCalString = eventToICalString(event, uid);

            await this.client.createCalendarObject({
              calendarUrl: this.config.calendarUrl,
              filename: `${uid}.ics`,
              iCalString,
            });

            return { remoteId: uid, success: true };
          } catch (error) {
            widelog.errorFields(error);
            return { error: getErrorMessage(error), success: false };
          }
        }),
      ),
    );
  }

  deleteEvents(eventIds: string[]): Promise<DeleteResult[]> {
    return Promise.all(
      eventIds.map((uid) =>
        this.rateLimiter.execute(async (): Promise<DeleteResult> => {
          widelog.set("destination.calendar_id", this.config.calendarId);
          widelog.set("operation.name", "caldav:delete");
          widelog.set("source.provider", this.id);
          widelog.set("user.id", this.config.userId);

          try {
            await this.client.deleteCalendarObject({
              calendarUrl: this.config.calendarUrl,
              filename: `${uid}.ics`,
            });
            return { success: true };
          } catch (error) {
            const notFound = error instanceof Error && error.message.includes("404");

            if (notFound) {
              return { success: true };
            }

            widelog.errorFields(error);
            return { error: getErrorMessage(error), success: false };
          }
        }),
      ),
    );
  }

  async listRemoteEvents(): Promise<RemoteEvent[]> {
    const syncWindow = getCalDAVSyncWindow(YEARS_UNTIL_FUTURE);

    const calendarUrl = await this.client.resolveCalendarUrl(this.config.calendarUrl);

    const objects = await this.client.fetchCalendarObjects({
      calendarUrl,
      timeRange: {
        end: syncWindow.end.toISOString(),
        start: syncWindow.start.toISOString(),
      },
    });

    const remoteEvents: RemoteEvent[] = [];

    for (const { data } of objects) {
      if (!data) {
        continue;
      }

      const parsed = parseICalToRemoteEvent(data);

      if (!parsed) {
        continue;
      }

      if (!isKeeperEvent(parsed.uid)) {
        continue;
      }

      if (parsed.endTime < syncWindow.start) {
        continue;
      }

      remoteEvents.push(parsed);
    }

    return remoteEvents;
  }
}

const createCalDAVProvider = (
  config: CalDAVProviderConfig,
  options: CalDAVProviderOptions = DEFAULT_CALDAV_OPTIONS,
): DestinationProvider => {
  const caldavService = createCalDAVService(config);

  const syncForUser = async (userId: string, context: SyncContext): Promise<SyncResult | null> => {
    const accounts = await caldavService.getCalDAVAccountsForUser(userId, options.providerId);
    if (accounts.length === EMPTY_ACCOUNTS_COUNT) {
      return null;
    }

    const results = await Promise.all(
      accounts.map(async (account) => {
        const localEvents = await getEventsForDestination(config.database, account.calendarId);
        const supportedEvents = localEvents.filter(
          (event) => event.availability !== "workingElsewhere",
        );

        const password = caldavService.getDecryptedPassword(account.encryptedPassword);
        const provider = new CalDAVProviderInstance(
          {
            calendarId: account.calendarId,
            calendarUrl: account.calendarUrl,
            database: config.database,
            serverUrl: account.serverUrl,
            userId: account.userId,
            username: account.username,
          },
          password,
          options,
        );
        return provider.sync(supportedEvents, context);
      }),
    );

    const combined: SyncResult = {
      addFailed: INITIAL_ADD_FAILED_COUNT,
      added: INITIAL_ADDED_COUNT,
      removeFailed: INITIAL_REMOVE_FAILED_COUNT,
      removed: INITIAL_REMOVED_COUNT,
    };
    for (const result of results) {
      combined.added += result.added;
      combined.addFailed += result.addFailed;
      combined.removed += result.removed;
      combined.removeFailed += result.removeFailed;
    }
    return combined;
  };

  return { syncForUser };
};

export { createCalDAVProvider };
