import { convertIcsCalendar, generateIcsCalendar } from "ts-ics";
import type { IcsCalendar, IcsEvent } from "ts-ics";
import { buildZonedIcsDate } from "../../../ics/utils/build-zoned-date";
import {
  collectDefinedTimezoneIds,
  extractProperties,
  patchIcsEvent,
  readEventAudience,
  readEventAuthorship,
} from "./patch-ics";
import {
  attemptSourceWrite,
  isRetryableWriteStatus,
  refuseWhenOutOfReach,
  toWriteFailure,
} from "../../../core/source/writer";
import type {
  CalendarSourceWriter,
  SourceEventUpdate,
  SourceWriteResult,
  WriteBackReach,
} from "../../../core/source/writer";

const NOT_FOUND_STATUS = 404;
const OK_STATUS = 200;
const REDIRECT_STATUS = 300;
const KEEPER_PRODUCT_ID = "-//Keeper.sh//Keeper.sh//EN";
const ICALENDAR_VERSION = "2.0";

interface CalDAVObject {
  data?: string;
  url: string;
}

interface CalDAVWriterClient {
  deleteCalendarObject: (input: { calendarObject: { url: string } }) => Promise<unknown>;
  fetchCalendarObjects: (input: {
    calendar: { url: string };
    filters?: Record<string, unknown>;
    objectUrls?: string[];
  }) => Promise<CalDAVObject[]>;
  updateCalendarObject: (
    input: { calendarObject: { data: string; url: string } },
  ) => Promise<unknown>;
}

/*
 * The address the account is known by, weighed against the object's ORGANIZER. The servers
 * that sign a user in by bare username store none, so the question has no answer there and
 * no write is refused for it — which is the whole reason two-way sync reaches them.
 */
interface CalDAVSourceWriterConfig {
  accountEmail?: string | null;
  writeBackReach?: WriteBackReach;
  accountUsername?: string | null;
  calendarUrl: string;
  client: () => Promise<CalDAVWriterClient>;
}

const ensureTrailingSlash = (url: string): string => {
  if (url.endsWith("/")) {
    return url;
  }
  return `${url}/`;
};

const parseIcsString = (icsString: string): IcsCalendar =>
  // eslint-disable-next-line no-undefined -- convertIcsCalendar takes undefined when there is no schema
  convertIcsCalendar(undefined, icsString);

const buildUidFilter = (sourceEventUid: string): Record<string, unknown> => ({
  "comp-filter": {
    "_attributes": { name: "VCALENDAR" },
    "comp-filter": {
      "_attributes": { name: "VEVENT" },
      "prop-filter": {
        "_attributes": { name: "UID" },
        "text-match": { "_attributes": { collation: "i;octet" }, "_text": sourceEventUid },
      },
    },
  },
});

const resolveIsAllDay = (updates: SourceEventUpdate, event: IcsEvent): boolean => {
  if (typeof updates.isAllDay === "boolean") {
    return updates.isAllDay;
  }
  return event.start?.type === "DATE";
};

/*
 * A TZID the object does not define would leave the file referencing a timezone that is
 * not in it, so the event's own representation wins whenever the source's stored zone is
 * not already declared alongside it.
 */
const resolveTimezone = (
  event: IcsEvent,
  updates: SourceEventUpdate,
  definedTimezoneIds: ReadonlySet<string>,
): string | undefined => {
  const existing = event.start?.local?.timezone;
  if (existing) {
    return existing;
  }
  if (updates.startTimeZone && definedTimezoneIds.has(updates.startTimeZone)) {
    return updates.startTimeZone;
  }
  // eslint-disable-next-line no-undefined -- an absent zone is a bare UTC datetime
  return undefined;
};

const applyUpdatesToEvent = (
  event: IcsEvent,
  updates: SourceEventUpdate,
  timezone: string | undefined,
): IcsEvent => {
  const isAllDay = resolveIsAllDay(updates, event);
  const patch: Partial<IcsEvent> = {
    stamp: { date: new Date() },
    ...(typeof updates.summary === "string" && { summary: updates.summary }),
    ...("description" in updates && { description: updates.description }),
    ...("location" in updates && { location: updates.location }),
    ...(updates.startTime && {
      start: buildZonedIcsDate(updates.startTime, timezone, isAllDay),
    }),
    ...(updates.endTime && { end: buildZonedIcsDate(updates.endTime, timezone, isAllDay) }),
  };

  return { ...event, ...patch } as IcsEvent;
};

const collectChangedPropertyNames = (updates: SourceEventUpdate): Set<string> => {
  const names = new Set<string>(["DTSTAMP"]);
  if (typeof updates.summary === "string") {
    names.add("SUMMARY");
  }
  if ("description" in updates) {
    names.add("DESCRIPTION");
  }
  if ("location" in updates) {
    names.add("LOCATION");
  }
  if (updates.startTime) {
    names.add("DTSTART");
  }
  if (updates.endTime) {
    names.add("DTEND");
    names.add("DURATION");
  }
  return names;
};

const isNotFoundError = (error: unknown): boolean =>
  error instanceof Error && "status" in error && error.status === NOT_FOUND_STATUS;

/*
 * Tsdav resolves a write with the raw fetch Response and rejects on nothing but a
 * transport error, so a server that refuses the write — a read-only share, a failed
 * precondition, an expired password — arrives here as a resolved value. Reading that as a
 * success would report an edit or a deletion of the user's real event that never happened.
 */
interface LookupFailure {
  error: string;
  retryable: boolean;
}

const readWriteStatus = (result: unknown): number => {
  if (typeof result !== "object" || result === null) {
    throw new Error("The CalDAV server returned no response to the write.");
  }
  const { status } = result as { status?: unknown };
  if (typeof status !== "number") {
    throw new TypeError("The CalDAV server returned no status for the write.");
  }
  return status;
};

const isSuccessfulStatus = (status: number): boolean =>
  status >= OK_STATUS && status < REDIRECT_STATUS;

const readErrorText = (error: unknown): string | null => {
  if (error instanceof Error) {
    return error.message;
  }
  return null;
};

/*
 * Tsdav raises a plain error for a server that is down, a connection that never opened and
 * a discovery step that failed, and none of them carry a status this can read. Every one of
 * them happened before the server was asked to change anything, and every one of them can
 * clear on its own, so they are retried rather than spent as a refusal. A rejection that
 * does name a status is judged on it: a password the server has answered 401 to will not
 * be accepted by asking again, and pausing the pair over it tells the user something they
 * can act on.
 */
const describeLookupFailure = (error: unknown): LookupFailure => {
  const { status } = (error ?? {}) as { status?: unknown };
  const message = readErrorText(error);
  if (typeof status === "number") {
    return { error: message ?? String(status), retryable: isRetryableWriteStatus(status) };
  }
  return { error: message ?? "The CalDAV lookup failed.", retryable: true };
};

const isLookupFailure = (
  located: CalDAVObject | CalDAVWriterClient | null | { lookupError: LookupFailure },
): located is { lookupError: LookupFailure } =>
  located !== null && "lookupError" in located;

const createCalDAVSourceWriter = (
  config: CalDAVSourceWriterConfig,
): CalendarSourceWriter => {
  const buildObjectUrl = (sourceEventUid: string): string =>
    `${ensureTrailingSlash(config.calendarUrl)}${sourceEventUid}.ics`;

  const matchesUid = (object: CalDAVObject, sourceEventUid: string): boolean => {
    if (!object.data) {
      return false;
    }
    const [event] = parseIcsString(object.data).events ?? [];
    return event?.uid === sourceEventUid;
  };

  /*
   * The object filename is chosen by whichever client created the event, so it only
   * happens to equal the UID for events Keeper.sh itself wrote. Guessing it and reading
   * the miss as "already gone" would report a delete that never reached the server.
   */
  const locateObject = async (
    client: CalDAVWriterClient,
    sourceEventUid: string,
  ): Promise<CalDAVObject | null> => {
    const direct = await client.fetchCalendarObjects({
      calendar: { url: config.calendarUrl },
      objectUrls: [buildObjectUrl(sourceEventUid)],
    }).catch((error: unknown) => {
      if (isNotFoundError(error)) {
        return [];
      }
      throw error;
    });
    const [candidate] = direct;
    if (candidate && matchesUid(candidate, sourceEventUid)) {
      return candidate;
    }

    const found = await client.fetchCalendarObjects({
      calendar: { url: config.calendarUrl },
      filters: buildUidFilter(sourceEventUid),
    });
    return found.find((object) => matchesUid(object, sourceEventUid)) ?? null;
  };

  /*
   * The lookup runs before the server is asked to change or destroy anything, so every way
   * it can fail touched nothing. It has to reach the caller as an answer it can read: an
   * exception is indistinguishable from one raised after the write, and the write-back
   * pass can only release the record of a deletion it knows did not happen.
   */
  const findObject = (
    client: CalDAVWriterClient,
    sourceEventUid: string,
  ): Promise<CalDAVObject | null | { lookupError: LookupFailure }> =>
    locateObject(client, sourceEventUid).catch((error: unknown) => ({
      lookupError: describeLookupFailure(error),
    }));

  /*
   * Building the client is itself a conversation with the server — tsdav discovers the
   * service, the principal and the calendar home before it hands one back — so a server
   * that is down or a password that no longer works rejects here, having touched nothing.
   * That has to reach the caller as an answer for the same reason the lookup does.
   */
  const openClient = (): Promise<CalDAVWriterClient | { lookupError: LookupFailure }> =>
    config.client().catch((error: unknown) => ({
      lookupError: describeLookupFailure(error),
    }));

  const updateEvent = async (
    reference: { sourceEventId: string | null; sourceEventUid: string },
    updates: SourceEventUpdate,
  ): Promise<SourceWriteResult> => {
    const client = await openClient();
    if (isLookupFailure(client)) {
      return toWriteFailure(client.lookupError.error, client.lookupError.retryable);
    }
    const located = await findObject(client, reference.sourceEventUid);
    if (isLookupFailure(located)) {
      return toWriteFailure(located.lookupError.error, located.lookupError.retryable);
    }
    const object = located;
    if (!object?.data) {
      return { error: "Event not found on the CalDAV server.", success: false };
    }
    const refusal = refuseWhenOutOfReach({
      audience: readEventAudience(object.data),
      authorship: readEventAuthorship(object.data, config.accountEmail),
      isDelete: false,
      updates,
    }, config.writeBackReach ?? "own_events");
    if (refusal) {
      return refusal;
    }

    const [event] = parseIcsString(object.data).events ?? [];
    if (!event) {
      return { error: "Could not parse the event on the CalDAV server.", success: false };
    }

    const timezone = resolveTimezone(event, updates, collectDefinedTimezoneIds(object.data));
    const propertyNames = collectChangedPropertyNames(updates);
    const rendered = generateIcsCalendar({
      events: [applyUpdatesToEvent(event, updates, timezone)],
      prodId: KEEPER_PRODUCT_ID,
      version: ICALENDAR_VERSION,
    });
    const data = patchIcsEvent({
      ics: object.data,
      properties: extractProperties(rendered, propertyNames),
      propertyNames,
      uid: reference.sourceEventUid,
    });
    if (!data) {
      return {
        error: "Could not locate the event to edit inside the CalDAV object.",
        success: false,
      };
    }

    const sent = await attemptSourceWrite(
      () => client.updateCalendarObject({ calendarObject: { data, url: object.url } }),
      "The edit on the CalDAV server never got an answer.",
    );
    if ("failure" in sent) {
      return sent.failure;
    }
    const status = readWriteStatus(sent.sent);
    if (!isSuccessfulStatus(status)) {
      return toWriteFailure(
        `The CalDAV server refused the edit with status ${status}.`,
        isRetryableWriteStatus(status),
      );
    }
    return { success: true };
  };

  const deleteEvent = async (
    reference: { sourceEventId: string | null; sourceEventUid: string },
  ): Promise<SourceWriteResult> => {
    const client = await openClient();
    if (isLookupFailure(client)) {
      return toWriteFailure(client.lookupError.error, client.lookupError.retryable);
    }
    const located = await findObject(client, reference.sourceEventUid);
    if (isLookupFailure(located)) {
      return toWriteFailure(located.lookupError.error, located.lookupError.retryable);
    }
    const object = located;
    if (!object) {
      return { success: true };
    }
    const refusal = refuseWhenOutOfReach({
      audience: readEventAudience(object.data ?? ""),
      authorship: readEventAuthorship(object.data ?? "", config.accountEmail),
      isDelete: true,
    }, config.writeBackReach ?? "own_events");
    if (refusal) {
      return refusal;
    }

    const removed = await attemptSourceWrite(
      () => client
        .deleteCalendarObject({ calendarObject: { url: object.url } })
        .then(readWriteStatus)
        .catch((error: unknown) => {
          if (isNotFoundError(error)) {
            return NOT_FOUND_STATUS;
          }
          throw error;
        }),
      "The deletion on the CalDAV server never got an answer.",
    );
    if ("failure" in removed) {
      return removed.failure;
    }
    const status = removed.sent;
    if (!isSuccessfulStatus(status) && status !== NOT_FOUND_STATUS) {
      return toWriteFailure(
        `The CalDAV server refused the deletion with status ${status}.`,
        isRetryableWriteStatus(status),
      );
    }
    return { success: true };
  };

  return { deleteEvent, updateEvent };
};

export { createCalDAVSourceWriter };
export type { CalDAVSourceWriterConfig, CalDAVWriterClient };
