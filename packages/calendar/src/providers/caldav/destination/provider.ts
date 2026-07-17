import { RateLimiter } from "../../../core/utils/rate-limiter";
import { generateDeterministicEventUid, isKeeperEvent } from "../../../core/events/identity";
import { createSyncEventContentHash } from "../../../core/events/content-hash";
import { getErrorMessage } from "../../../core/utils/error";
import type { DeleteResult, PushResult, RemoteEvent, SyncableEvent } from "../../../core/types";
import { CalDAVClient, CalDAVCreateConflictError, CalDAVHttpError } from "../shared/client";
import { eventToICalString, parseICalToRemoteEvent, parseICalToRemoteEvents } from "../shared/ics";
import { getCalDAVSyncWindow } from "../shared/sync-window";
import type { SafeFetchOptions } from "../../../utils/safe-fetch";

const CALDAV_RATE_LIMIT_CONCURRENCY = 5;
const YEARS_UNTIL_FUTURE = 2;

interface CalDAVSyncProviderConfig {
  authMethod?: "basic" | "digest";
  calendarUrl: string;
  serverUrl: string;
  username: string;
  password: string;
  safeFetchOptions?: SafeFetchOptions;
}

class CalDAVConflictRecoveryError extends Error {
  constructor(uid: string, cause: unknown) {
    super(
      `CalDAV create conflict recovery failed for event ${uid}: ${getErrorMessage(cause)}`,
      { cause },
    );
    this.name = "CalDAVConflictRecoveryError";
  }
}

const findCalDAVHttpError = (value: unknown): CalDAVHttpError | null => {
  let candidate = value;
  const visited = new Set<unknown>();

  while (candidate instanceof Error && !visited.has(candidate)) {
    if (candidate instanceof CalDAVHttpError) {
      return candidate;
    }
    visited.add(candidate);
    candidate = candidate.cause;
  }
  return null;
};

const createFailureResult = (error: unknown): {
  error: string;
  errorType: string;
  statusCode?: number;
  success: false;
} => {
  const httpError = findCalDAVHttpError(error);
  let errorType = "UnknownError";
  if (error instanceof Error) {
    errorType = error.name;
  }
  return {
    error: getErrorMessage(error),
    errorType,
    ...(httpError && { statusCode: httpError.status }),
    success: false,
  };
};

const recoverCreateConflict = async (
  client: CalDAVClient,
  calendarUrl: string,
  uid: string,
  iCalString: string,
  event: SyncableEvent,
): Promise<void> => {
  const existing = await client.fetchCalendarObject({
    calendarUrl,
    filename: `${uid}.ics`,
  });

  if (!existing?.data) {
    throw new Error(`CalDAV event ${uid} already exists but could not be fetched`);
  }

  const remoteEvent = parseICalToRemoteEvent(existing.data);
  let remoteEventHash: string | null = null;
  if (remoteEvent) {
    remoteEventHash = createSyncEventContentHash({
      availability: remoteEvent.availability,
      description: remoteEvent.description,
      endTime: remoteEvent.endTime,
      isAllDay: remoteEvent.isAllDay,
      location: remoteEvent.location,
      startTime: remoteEvent.startTime,
      startTimeZone: remoteEvent.startTimeZone,
      summary: remoteEvent.title ?? "",
    });
  }

  if (remoteEvent?.uid === uid && remoteEventHash === createSyncEventContentHash(event)) {
    return;
  }

  if (!existing.etag) {
    throw new Error(`CalDAV event ${uid} already exists but has no ETag for a safe recreation`);
  }

  await client.deleteCalendarObject({
    calendarUrl,
    filename: `${uid}.ics`,
    etag: existing.etag,
  });
  await client.createCalendarObject({
    calendarUrl,
    filename: `${uid}.ics`,
    iCalString,
  });
};

const createCalDAVSyncProvider = (config: CalDAVSyncProviderConfig) => {
  const client = new CalDAVClient({
    authMethod: config.authMethod,
    credentials: { password: config.password, username: config.username },
    serverUrl: config.serverUrl,
  }, config.safeFetchOptions);

  const rateLimiter = new RateLimiter({ concurrency: CALDAV_RATE_LIMIT_CONCURRENCY });

  const pushEvents = (events: SyncableEvent[]): Promise<PushResult[]> =>
    Promise.all(
      events.map((event) =>
        rateLimiter.execute(async (): Promise<PushResult> => {
          try {
            const uid = generateDeterministicEventUid(event.id);
            const iCalString = eventToICalString(event, uid);

            try {
              await client.createCalendarObject({
                calendarUrl: config.calendarUrl,
                filename: `${uid}.ics`,
                iCalString,
              });
            } catch (error) {
              if (!(error instanceof CalDAVCreateConflictError)) {
                throw error;
              }

              try {
                await recoverCreateConflict(client, config.calendarUrl, uid, iCalString, event);
              } catch (recoveryError) {
                throw new CalDAVConflictRecoveryError(uid, recoveryError);
              }
              return { conflictResolved: true, deleteId: uid, remoteId: uid, success: true };
            }

            return { deleteId: uid, remoteId: uid, success: true };
          } catch (error) {
            if (config.safeFetchOptions?.signal?.aborted) {
              throw error;
            }
            return createFailureResult(error);
          }
        }, config.safeFetchOptions?.signal),
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
            if (config.safeFetchOptions?.signal?.aborted) {
              throw error;
            }
            const notFound = error instanceof CalDAVHttpError && error.status === 404;
            if (notFound) {
              return { success: true };
            }
            return createFailureResult(error);
          }
        }, config.safeFetchOptions?.signal),
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

      for (const parsed of parseICalToRemoteEvents(data)) {
        if (!isKeeperEvent(parsed.uid) || parsed.endTime < syncWindow.start) {
          continue;
        }

        remoteEvents.push(parsed);
      }
    }

    return remoteEvents;
  };

  return { pushEvents, deleteEvents, listRemoteEvents };
};

export { createCalDAVSyncProvider };
export type { CalDAVSyncProviderConfig };
