import {
  CalendarProvider,
  RateLimiter,
  generateEventUid,
  getErrorMessage,
  getEventsForDestination,
  isKeeperEvent,
} from "@keeper.sh/integration";
import type {
  CalDAVConfig,
  DeleteResult,
  DestinationProvider,
  PushResult,
  RemoteEvent,
  SyncContext,
  SyncResult,
  SyncableEvent,
} from "@keeper.sh/integration";
import { getStartOfToday } from "@keeper.sh/date-utils";
import { getWideEvent } from "@keeper.sh/log";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { CalDAVClient } from "./utils/client";
import { eventToICalString, parseICalToRemoteEvent } from "./utils/ics";
import { createCalDAVService } from "./utils/accounts";

const EMPTY_ACCOUNTS_COUNT = 0;
const INITIAL_ADDED_COUNT = 0;
const INITIAL_ADD_FAILED_COUNT = 0;
const INITIAL_REMOVED_COUNT = 0;
const INITIAL_REMOVE_FAILED_COUNT = 0;
const CALDAV_RATE_LIMIT_CONCURRENCY = 5;
const YEARS_UNTIL_FUTURE = 10;

interface CalDAVProviderOptions {
  providerId: string;
  providerName: string;
}

interface CalDAVProviderConfig {
  database: BunSQLDatabase;
  encryptionKey: string;
}

const DEFAULT_CALDAV_OPTIONS: CalDAVProviderOptions = {
  providerId: "caldav",
  providerName: "CalDAV",
};

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
        const localEvents = await getEventsForDestination(config.database, account.destinationId);

        const password = caldavService.getDecryptedPassword(account.encryptedPassword);
        const provider = new CalDAVProviderInstance(
          {
            calendarUrl: account.calendarUrl,
            database: config.database,
            destinationId: account.destinationId,
            serverUrl: account.serverUrl,
            userId: account.userId,
            username: account.username,
          },
          password,
          options,
        );
        return provider.sync(localEvents, context);
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

  async pushEvents(events: SyncableEvent[]): Promise<PushResult[]> {
    const results = await Promise.all(
      events.map((event) =>
        this.rateLimiter.execute(async (): Promise<PushResult> => {
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
            getWideEvent()?.setError(error);
            return { error: getErrorMessage(error), success: false };
          }
        }),
      ),
    );

    return results;
  }

  async deleteEvents(eventIds: string[]): Promise<DeleteResult[]> {
    const results = await Promise.all(
      eventIds.map((uid) =>
        this.rateLimiter.execute(async (): Promise<DeleteResult> => {
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

            return { error: getErrorMessage(error), success: false };
          }
        }),
      ),
    );

    return results;
  }

  async listRemoteEvents(): Promise<RemoteEvent[]> {
    const today = getStartOfToday();

    const tenYearsOut = new Date(today);
    tenYearsOut.setFullYear(tenYearsOut.getFullYear() + YEARS_UNTIL_FUTURE);

    const calendarUrl = await this.client.resolveCalendarUrl(this.config.calendarUrl);

    const objects = await this.client.fetchCalendarObjects({
      calendarUrl,
      timeRange: {
        end: tenYearsOut.toISOString(),
        start: today.toISOString(),
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

      if (parsed.endTime < today) {
        continue;
      }

      remoteEvents.push(parsed);
    }

    return remoteEvents;
  }
}

export { createCalDAVProvider };
export type { CalDAVProviderOptions, CalDAVProviderConfig };
