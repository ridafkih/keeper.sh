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
  RemoteEventListing,
  RemoteEventPresence,
  RemoteEventReference,
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
import type { SafeFetchOptions } from "../../../utils/safe-fetch";
import { normalizeCalDAVEvent } from "./normalize-event";

const CALDAV_RATE_LIMIT_CONCURRENCY = 5;
const CALDAV_NOT_FOUND_STATUS = 404;

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

/*
 * A probe may only answer "absent" on a definitive not-found, so the status is read off
 * the error itself rather than inferred from its class: a transport wrapper that loses
 * the CalDAVHttpError prototype must not be mistaken for a missing object.
 */
const findErrorStatus = (value: unknown): number | null => {
  let candidate = value;
  const visited = new Set<unknown>();

  while (candidate instanceof Error && !visited.has(candidate)) {
    const { status } = candidate as Error & { status?: unknown };
    if (typeof status === "number") {
      return status;
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
            const notFound = error instanceof CalDAVHttpError
              && error.status === CALDAV_NOT_FOUND_STATUS;
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
  ): Promise<RemoteEventListing> => {
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
      const resources = parseICalCalendarsToRemoteEvents(
        [data],
        { rejectUnsupportedRecurrenceDates: false },
      );
      assertAllResourcesRead(resources);
      assertAllEventsSupported(resources);
      const objectPath = new URL(url, calendarUrl).pathname;
      for (const parsed of resources.events) {
        const beyondHorizon = parsed.startTime > options.timeMax;
        if (
          !isKeeperEvent(parsed.uid)
          || beyondHorizon
          || resolveTimeRangeEnd(parsed) < options.timeMin
        ) {
          continue;
        }

        const editableContent = createEditableEventContentSnapshot({
          availability: parsed.availability,
          description: parsed.description,
          endTime: parsed.endTime,
          isAllDay: parsed.isAllDay,
          location: parsed.location,
          startTime: parsed.startTime,
          summary: parsed.title ?? "",
        });
        remoteEvents.push({
          ...parsed,
          deleteId: objectPath,
          editableAvailability: parsed.availability,
          editableContent,
          editableContentHash: hashEditableEventContentSnapshot(editableContent),
          editableFields: {
            isAllDay: parsed.isAllDay ?? false,
            summary: parsed.title ?? "",
            ...(parsed.description && { description: parsed.description }),
            ...(parsed.location && { location: parsed.location }),
          },
          supportedAvailabilities: ["busy", "free"],
        });
      }
    }

    /*
     * What the server listed, before the Keeper path filter narrowed it. A count taken
     * after the filter cannot tell a destination holding only the user's own events from
     * one the server answered nothing for, and the second of those is what holds a
     * deletion back to ask the user first.
     */
    return { items: remoteEvents, rawItemCount: listing?.listedCount ?? objects.length };
  };

  const readObjectFilename = (href: string): string | null => {
    try {
      return decodeURIComponent(
        new URL(href, config.calendarUrl).pathname.split("/").at(-1) ?? "",
      );
    } catch {
      /*
       * An href this parser cannot read identifies nothing, and answering "not the copy"
       * on its behalf points the corroboration at deletion. The object's own UID decides
       * instead.
       */
      return null;
    }
  };

  const isObjectForUid = (object: { data?: string; url: string }, uid: string): boolean => {
    if (readObjectFilename(object.url) === `${uid}.ics`) {
      return true;
    }
    if (!object.data) {
      return false;
    }
    return parseICalToRemoteEvent(object.data)?.uid === uid;
  };

  /*
   * An empty multiget answer is not proof: it is the same shape the collection read
   * rejects as incomplete. Corroborating it against a listing the server proved complete
   * is what turns "the object was not in the response" into "the object is not there".
   */
  const isMissingFromCompleteListing = async (
    calendarUrl: string,
    uid: string,
  ): Promise<boolean> => {
    const objects = await client.fetchCalendarObjects({ calendarUrl });
    return !objects.some((object) => isObjectForUid(object, uid));
  };

  /*
   * The ICS parser drops cancelled and start-less events, so a copy can be missing from
   * listRemoteEvents while it is still on the server. A targeted fetch of the object
   * itself is the only evidence of absence that justifies destroying the original on the
   * source, and anything short of a definitive not-found refuses. A copy filed under
   * another name keeps its UID, so the collection listing decides when the multiget
   * answers nothing.
   */
  const findCopyIn = async (
    calendarUrl: string,
    uid: string,
  ): Promise<RemoteEventPresence> => {
    try {
      const existing = await client.fetchCalendarObject({
        calendarUrl,
        filename: `${uid}.ics`,
      });
      if (existing?.data) {
        return "present";
      }
    } catch (error) {
      if (findErrorStatus(error) !== CALDAV_NOT_FOUND_STATUS) {
        throw error;
      }
    }

    if (await isMissingFromCompleteListing(calendarUrl, uid)) {
      return "absent";
    }
    return "present";
  };

  /*
   * A CalDAV read is scoped to one collection, so the destination collection alone cannot
   * tell a deleted copy from one the user dragged into another calendar of the same
   * account — a move the client performs as a delete here and a put there, UID intact,
   * and the copy is still one the user can see. Every collection the account lists is
   * asked before the original on the source is destroyed, and a collection that cannot be
   * read is refused rather than assumed empty: the throw reaches the caller, which reads
   * it as "do not delete".
   */
  const probeRemoteEvent = async (
    reference: RemoteEventReference,
  ): Promise<RemoteEventPresence> => {
    /*
     * Resolved exactly as the list read resolves it, and outside the catch below. A
     * collection that has moved answers not-found for every object in it, and reading
     * that as an absence would destroy originals whose copies are still there.
     */
    const calendarUrl = await client.resolveCalendarUrl(config.calendarUrl);
    if (await findCopyIn(calendarUrl, reference.uid) === "present") {
      return "present";
    }

    const calendars = await client.discoverCalendars();
    for (const calendar of calendars) {
      if (calendar.url === calendarUrl || calendar.url === config.calendarUrl) {
        continue;
      }
      if (await findCopyIn(calendar.url, reference.uid) === "present") {
        return "present";
      }
    }
    return "absent";
  };

  return {
    pushEvents,
    deleteEvents,
    getSyncDiagnostics,
    listRemoteEvents,
    normalizeEvent: normalizeCalDAVEvent,
    probeRemoteEvent,
  };
};

export { createCalDAVSyncProvider };
export type { CalDAVSyncProviderConfig };
