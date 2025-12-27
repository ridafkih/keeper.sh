import {
  CalendarProvider,
  RateLimiter,
  type SyncableEvent,
  type PushResult,
  type DeleteResult,
  type RemoteEvent,
  type SyncResult,
  type CalDAVConfig,
  type SyncContext,
} from "@keeper.sh/integrations";
import { CalDAVClient } from "./caldav-client";
import { eventToICalString, parseICalToRemoteEvent } from "./ics-converter";
import {
  getCalDAVAccountsForUser,
  getUserEvents,
  getDecryptedPassword,
  type CalDAVAccount,
} from "./sync";

export interface CalDAVProviderOptions {
  providerId: string;
  providerName: string;
}

export class CalDAVProvider extends CalendarProvider<CalDAVConfig> {
  readonly name: string;
  readonly id: string;

  private client: CalDAVClient;
  private rateLimiter: RateLimiter;

  constructor(
    config: CalDAVConfig,
    password: string,
    options: CalDAVProviderOptions = {
      providerId: "caldav",
      providerName: "CalDAV",
    },
  ) {
    super(config);
    this.id = options.providerId;
    this.name = options.providerName;
    this.client = new CalDAVClient({
      serverUrl: config.serverUrl,
      credentials: {
        username: config.username,
        password,
      },
    });

    this.rateLimiter = new RateLimiter(5);
  }

  static async syncForUser(
    userId: string,
    context: SyncContext,
  ): Promise<SyncResult | null> {
    const accounts = await getCalDAVAccountsForUser(userId, "caldav");
    if (accounts.length === 0) return null;

    const localEvents = await getUserEvents(userId);

    const results = await Promise.all(
      accounts.map((account) =>
        CalDAVProvider.syncAccount(account, localEvents, context),
      ),
    );

    return results.reduce<SyncResult>(
      (combined, result) => ({
        added: combined.added + result.added,
        removed: combined.removed + result.removed,
      }),
      { added: 0, removed: 0 },
    );
  }

  protected static async syncAccount(
    account: CalDAVAccount,
    localEvents: SyncableEvent[],
    context: SyncContext,
    options: CalDAVProviderOptions = {
      providerId: "caldav",
      providerName: "CalDAV",
    },
  ): Promise<SyncResult> {
    const password = getDecryptedPassword(account.encryptedPassword);
    const provider = new CalDAVProvider(
      {
        destinationId: account.destinationId,
        userId: account.userId,
        serverUrl: account.serverUrl,
        username: account.username,
        calendarUrl: account.calendarUrl,
      },
      password,
      options,
    );
    return provider.sync(localEvents, context);
  }

  async pushEvents(events: SyncableEvent[]): Promise<PushResult[]> {
    const results = await Promise.all(
      events.map((event) =>
        this.rateLimiter.execute(async (): Promise<PushResult> => {
          try {
            const uid = this.generateUid();
            const iCalString = eventToICalString(event, uid);

            await this.client.createCalendarObject({
              calendarUrl: this.config.calendarUrl,
              filename: `${uid}.ics`,
              iCalString,
            });

            return { success: true, remoteId: uid };
          } catch (error) {
            this.childLog.error({ error }, "failed to push event");
            return { success: false, error: "Failed to push event" };
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
            const notFound =
              error instanceof Error && error.message.includes("404");

            if (notFound) {
              return { success: true };
            }

            this.childLog.error({ error, uid }, "failed to delete event");
            return { success: false, error: "Failed to delete event" };
          }
        }),
      ),
    );

    return results;
  }

  async listRemoteEvents(): Promise<RemoteEvent[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tenYearsOut = new Date(today);
    tenYearsOut.setFullYear(tenYearsOut.getFullYear() + 10);

    const calendarUrl = await this.client.resolveCalendarUrl(
      this.config.calendarUrl,
    );

    const objects = await this.client.fetchCalendarObjects({
      calendarUrl,
      timeRange: {
        start: today.toISOString(),
        end: tenYearsOut.toISOString(),
      },
    });

    this.childLog.debug(
      { objectCount: objects.length },
      "fetched calendar objects",
    );

    const remoteEvents: RemoteEvent[] = [];
    let noData = 0;
    let parseFailed = 0;
    let notKeeper = 0;
    let pastEvents = 0;

    for (const { data } of objects) {
      if (!data) {
        noData++;
        continue;
      }

      const parsed = parseICalToRemoteEvent(data);

      if (!parsed) {
        parseFailed++;
        continue;
      }

      if (!this.isKeeperEvent(parsed.uid)) {
        notKeeper++;
        continue;
      }

      if (parsed.endTime < today) {
        pastEvents++;
        continue;
      }

      remoteEvents.push(parsed);
    }

    this.childLog.debug(
      {
        provider: this.name,
        objectCount: objects.length,
        keeperEventCount: remoteEvents.length,
        calendarUrl: this.config.calendarUrl,
      },
      "listed remote events",
    );
    return remoteEvents;
  }
}
