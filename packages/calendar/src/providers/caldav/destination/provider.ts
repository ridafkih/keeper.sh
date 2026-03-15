import { RateLimiter } from "../../../core/utils/rate-limiter";
import { generateEventUid, isKeeperEvent } from "../../../core/events/identity";
import { getErrorMessage } from "../../../core/utils/error";
import type { DeleteResult, PushResult, RemoteEvent, SyncableEvent } from "../../../core/types";
import { CalDAVClient } from "../shared/client";
import { eventToICalString, parseICalToRemoteEvent } from "../shared/ics";
import { getCalDAVSyncWindow } from "../shared/sync-window";

const CALDAV_RATE_LIMIT_CONCURRENCY = 5;
const YEARS_UNTIL_FUTURE = 2;

interface CalDAVSyncProviderConfig {
  calendarUrl: string;
  serverUrl: string;
  username: string;
  password: string;
}

const createCalDAVSyncProvider = (config: CalDAVSyncProviderConfig) => {
  const client = new CalDAVClient({
    credentials: { password: config.password, username: config.username },
    serverUrl: config.serverUrl,
  });

  const rateLimiter = new RateLimiter({ concurrency: CALDAV_RATE_LIMIT_CONCURRENCY });

  const pushEvents = (events: SyncableEvent[]): Promise<PushResult[]> =>
    Promise.all(
      events.map((event) =>
        rateLimiter.execute(async (): Promise<PushResult> => {
          try {
            const uid = generateEventUid();
            const iCalString = eventToICalString(event, uid);

            await client.createCalendarObject({
              calendarUrl: config.calendarUrl,
              filename: `${uid}.ics`,
              iCalString,
            });

            return { remoteId: uid, success: true };
          } catch (error) {
            return { error: getErrorMessage(error), success: false };
          }
        }),
      ),
    );

  const deleteEvents = (eventIds: string[]): Promise<DeleteResult[]> =>
    Promise.all(
      eventIds.map((uid) =>
        rateLimiter.execute(async (): Promise<DeleteResult> => {
          try {
            await client.deleteCalendarObject({
              calendarUrl: config.calendarUrl,
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

  const listRemoteEvents = async (): Promise<RemoteEvent[]> => {
    const syncWindow = getCalDAVSyncWindow(YEARS_UNTIL_FUTURE);
    const calendarUrl = await client.resolveCalendarUrl(config.calendarUrl);

    const objects = await client.fetchCalendarObjects({
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
      if (!parsed || !isKeeperEvent(parsed.uid) || parsed.endTime < syncWindow.start) {
        continue;
      }

      remoteEvents.push(parsed);
    }

    return remoteEvents;
  };

  return { pushEvents, deleteEvents, listRemoteEvents };
};

export { createCalDAVSyncProvider };
export type { CalDAVSyncProviderConfig };
