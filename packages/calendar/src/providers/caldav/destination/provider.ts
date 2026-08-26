import { RateLimiter } from "../../../core/utils/rate-limiter";
import { generateDeterministicEventUid, isKeeperEvent } from "../../../core/events/identity";
import {
  createEditableEventContentSnapshot,
  createSyncEventContentHash,
  hashEditableEventContentSnapshot,
} from "../../../core/events/content-hash";
import { getErrorMessage } from "../../../core/utils/error";
import { resolveTimeRangeEnd } from "../../../core/events/time-range";
import type {
  DeleteResult,
  ListRemoteEventsOptions,
  MaterializedSyncableEvent,
  PushResult,
  RemoteEvent,
} from "../../../core/types";
import { CalDAVClient, CalDAVCreateConflictError, CalDAVHttpError } from "../shared/client";
import type { CalDAVListingStats } from "../shared/client";
import {
  assertAllEventsSupported,
  assertAllResourcesRead,
  eventToICalString,
  parseICalCalendarsToRemoteEvents,
  parseICalToRemoteEvent,
} from "../shared/ics";
import type { ParsedCalendarEvent } from "../shared/ics";
import type { EventUpdate } from "../../../core/sync-engine/types";
import type { SafeFetchOptions } from "../../../utils/safe-fetch";
import { normalizeCalDAVEvent } from "./normalize-event";

const CALDAV_RATE_LIMIT_CONCURRENCY = 5;

// A CalDAV PUT answers 201/204 with no body, so there is nothing to compare the write against.
const CALDAV_PUSH_ECHO = { comparable: false, reason: "echo-body-missing" } as const;

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
  event: MaterializedSyncableEvent,
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

  /*
   * Our object names are derived from the source event, so two customers mirroring the same event
   * into one shared calendar land on the same href. The object already standing there is only ours
   * to replace if it says so: anything else is somebody else's event, and deleting it to make room
   * destroys a copy we were never asked to manage. Failing here costs us a mirror we could not
   * write; the alternative costs them the event itself.
   */
  if (remoteEvent?.uid !== uid) {
    throw new Error(
      `CalDAV object ${uid}.ics carries uid ${remoteEvent?.uid ?? "none"}, so it is not this event's mirror`,
    );
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

interface CalDAVRemoveCounts {
  byPath: number;
  byUid: number;
  failureStatuses: Map<number, number>;
  notFound: number;
  succeeded: number;
}

const toRemoveDiagnostics = (counts: CalDAVRemoveCounts): Record<string, number> => ({
  "events.remove_by_path": counts.byPath,
  "events.remove_by_uid": counts.byUid,
  "events.remove_not_found": counts.notFound,
  "events.remove_succeeded": counts.succeeded,
  ...Object.fromEntries(
    [...counts.failureStatuses].map(([status, count]) => [
      `events.remove_failed_status.${status}`,
      count,
    ]),
  ),
});

const toListingDiagnostics = (listing: CalDAVListingStats): Record<string, number> => ({
  "remote_objects.listed_count": listing.listedCount,
  "remote_objects.requested_count": listing.requestedCount,
  "remote_objects.returned_count": listing.returnedCount,
  "remote_objects.unrequested_count": listing.unrequestedCount,
});

const toCalendarBaseUrl = (calendarUrl: string): string => {
  if (calendarUrl.endsWith("/")) {
    return calendarUrl;
  }
  return `${calendarUrl}/`;
};

const parseCalendarObjectEvents = (data: string): ParsedCalendarEvent[] => {
  const resources = parseICalCalendarsToRemoteEvents(
    [data],
    { rejectUnsupportedRecurrenceDates: false },
  );
  assertAllResourcesRead(resources);
  assertAllEventsSupported(resources);
  return resources.events;
};

const toCalDAVRemoteEvent = (parsed: ParsedCalendarEvent, objectPath: string): RemoteEvent => {
  const editableContent = createEditableEventContentSnapshot({
    availability: parsed.availability,
    description: parsed.description,
    endTime: parsed.endTime,
    isAllDay: parsed.isAllDay,
    location: parsed.location,
    startTime: parsed.startTime,
    summary: parsed.title ?? "",
  });
  return {
    ...parsed,
    deleteId: objectPath,
    editableAvailability: parsed.availability,
    editableContent,
    editableContentHash: hashEditableEventContentSnapshot(editableContent),
    supportedAvailabilities: ["busy", "free"],
  };
};

const createCalDAVSyncProvider = (config: CalDAVSyncProviderConfig) => {
  const calendarHost = new URL(config.calendarUrl).hostname;
  const removeCounts: CalDAVRemoveCounts = {
    byPath: 0,
    byUid: 0,
    failureStatuses: new Map(),
    notFound: 0,
    succeeded: 0,
  };
  let removeAttempts = 0;
  let listing: CalDAVListingStats | null = null;

  const client = new CalDAVClient({
    authMethod: config.authMethod,
    credentials: { password: config.password, username: config.username },
    serverUrl: config.serverUrl,
  }, config.safeFetchOptions);

  const rateLimiter = new RateLimiter({ concurrency: CALDAV_RATE_LIMIT_CONCURRENCY });

  const isKeeperCalendarObjectPath = (path: string): boolean => {
    try {
      const filename = decodeURIComponent(path.split("/").at(-1) ?? "");
      if (!filename.endsWith(".ics")) {
        return false;
      }
      return isKeeperEvent(filename.slice(0, -4));
    } catch {
      return false;
    }
  };

  const isKeeperCalendarObjectUrl = (objectUrl: string): boolean => {
    try {
      return isKeeperCalendarObjectPath(new URL(objectUrl, config.calendarUrl).pathname);
    } catch {
      return false;
    }
  };

  const pushEvents = (events: MaterializedSyncableEvent[]): Promise<PushResult[]> =>
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
              return {
                conflictResolved: true,
                deleteId: uid,
                echo: CALDAV_PUSH_ECHO,
                remoteId: uid,
                success: true,
              };
            }

            return { deleteId: uid, echo: CALDAV_PUSH_ECHO, remoteId: uid, success: true };
          } catch (error) {
            if (config.safeFetchOptions?.signal?.aborted) {
              throw error;
            }
            return createFailureResult(error);
          }
        }, config.safeFetchOptions?.signal),
      ),
    );

  const calendarBaseUrl = toCalendarBaseUrl(config.calendarUrl);

  const toObjectUrl = (deleteId: string): string => {
    if (deleteId.includes("/")) {
      return new URL(deleteId, calendarBaseUrl).href;
    }
    return new URL(`${deleteId}.ics`, calendarBaseUrl).href;
  };

  /*
   * Servers may return the href percent-encoded, and every Keeper UID contains an
   * "@". Comparing decoded basenames keeps the write on the object the mapping
   * already points at instead of a reconstructed href that never matches.
   */
  const resolveUpdateTargetUrl = (deleteId: string, uid: string): string => {
    const objectUrl = toObjectUrl(deleteId);
    const filename = decodeURIComponent(new URL(objectUrl).pathname.split("/").at(-1) ?? "");
    if (filename !== `${uid}.ics`) {
      throw new Error(`CalDAV update target ${objectUrl} does not belong to event ${uid}`);
    }
    return objectUrl;
  };

  const updateEvents = (updates: EventUpdate[]): Promise<PushResult[]> =>
    Promise.all(
      updates.map(({ deleteId, event }) =>
        rateLimiter.execute(async (): Promise<PushResult> => {
          try {
            const uid = generateDeterministicEventUid(event.id);
            const objectUrl = resolveUpdateTargetUrl(deleteId, uid);

            await client.updateCalendarObjectByUrl({
              iCalString: eventToICalString(event, uid),
              objectUrl,
            });

            return { deleteId, echo: CALDAV_PUSH_ECHO, remoteId: uid, success: true };
          } catch (error) {
            if (config.safeFetchOptions?.signal?.aborted) {
              throw error;
            }
            return createFailureResult(error);
          }
        }, config.safeFetchOptions?.signal),
      ),
    );

  const recordRemoveFailure = (error: unknown): void => {
    const httpError = findCalDAVHttpError(error);
    if (!httpError) {
      return;
    }
    removeCounts.failureStatuses.set(
      httpError.status,
      (removeCounts.failureStatuses.get(httpError.status) ?? 0) + 1,
    );
  };

  /* Listed deleteIds are object paths; deleteIds stored before path recording are bare UIDs. */
  const deleteEventObject = (deleteId: string): Promise<void> => {
    if (deleteId.includes("/")) {
      return client.deleteCalendarObjectByUrl({
        objectUrl: new URL(deleteId, config.calendarUrl).href,
      });
    }
    return client.deleteCalendarObject({
      calendarUrl: config.calendarUrl,
      filename: `${deleteId}.ics`,
    });
  };

  const deleteEvents = (eventIds: string[]): Promise<DeleteResult[]> =>
    Promise.all(
      eventIds.map((deleteId) =>
        rateLimiter.execute(async (): Promise<DeleteResult> => {
          removeAttempts += 1;
          if (deleteId.includes("/")) {
            removeCounts.byPath += 1;
          } else {
            removeCounts.byUid += 1;
          }

          try {
            await deleteEventObject(deleteId);
            removeCounts.succeeded += 1;
            return { success: true };
          } catch (error) {
            if (config.safeFetchOptions?.signal?.aborted) {
              throw error;
            }
            const notFound = error instanceof CalDAVHttpError && error.status === 404;
            if (notFound) {
              removeCounts.notFound += 1;
              return { success: true };
            }
            recordRemoveFailure(error);
            return createFailureResult(error);
          }
        }, config.safeFetchOptions?.signal),
      ),
    );

  const getSyncDiagnostics = (): Record<string, number | string> => ({
    "provider.caldav.host": calendarHost,
    ...(listing && toListingDiagnostics(listing)),
    ...(removeAttempts > 0 && toRemoveDiagnostics(removeCounts)),
  });

  const listRemoteEvents = async (
    options: ListRemoteEventsOptions,
  ): Promise<RemoteEvent[]> => {
    const calendarUrl = await client.resolveCalendarUrl(config.calendarUrl);

    const objects = await client.fetchCalendarObjects({
      calendarUrl,
      onListing: (stats) => { listing = stats; },
      pathFilter: isKeeperCalendarObjectPath,
    });

    const remoteEvents: RemoteEvent[] = [];

    const keeperObjects = objects.flatMap(({ data, url }) => {
      if (!data || !isKeeperCalendarObjectUrl(url)) {
        return [];
      }
      return [{ data, url }];
    });
    for (const { data, url } of keeperObjects) {
      const objectPath = new URL(url, calendarUrl).pathname;
      for (const parsed of parseCalendarObjectEvents(data)) {
        const beyondHorizon = parsed.startTime > options.timeMax;
        if (
          !isKeeperEvent(parsed.uid)
          || beyondHorizon
          || resolveTimeRangeEnd(parsed) < options.timeMin
        ) {
          continue;
        }

        remoteEvents.push(toCalDAVRemoteEvent(parsed, objectPath));
      }
    }

    return remoteEvents;
  };

  const getRemoteEventsByIds = async (deleteIds: string[]): Promise<RemoteEvent[]> => {
    if (deleteIds.length === 0) {
      return [];
    }

    const calendarUrl = await client.resolveCalendarUrl(config.calendarUrl);
    const objects = await client.fetchCalendarObjectsByUrls({
      calendarUrl,
      objectUrls: deleteIds.map((deleteId) => toObjectUrl(deleteId)),
    });

    const remoteEvents: RemoteEvent[] = [];
    for (const { data, url } of objects) {
      if (!data || !isKeeperCalendarObjectUrl(url)) {
        continue;
      }
      const objectPath = new URL(url, calendarUrl).pathname;
      for (const parsed of parseCalendarObjectEvents(data)) {
        if (!isKeeperEvent(parsed.uid)) {
          continue;
        }
        remoteEvents.push(toCalDAVRemoteEvent(parsed, objectPath));
      }
    }

    return remoteEvents;
  };

  return {
    pushEvents,
    updateEvents,
    deleteEvents,
    getRemoteEventsByIds,
    getSyncDiagnostics,
    listRemoteEvents,
    normalizeEvent: normalizeCalDAVEvent,
  };
};

export { createCalDAVSyncProvider };
export type { CalDAVSyncProviderConfig };
