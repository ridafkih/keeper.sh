import {
  googleApiErrorSchema,
  googleEventWithAttendeesListSchema,
  googleEventWithAttendeesSchema,
} from "@keeper.sh/data-schemas";
import type { GoogleEventWithAttendees } from "@keeper.sh/data-schemas";
import { HTTP_STATUS, TWO_WAY_SOURCE_WRITE_TIMEOUT_MS } from "@keeper.sh/constants";
import { fetchWithTimeout } from "../../../core/utils/fetch-with-timeout";
import { GOOGLE_CALENDAR_API, GONE_STATUS } from "../shared/api";
import {
  isRetryableWriteStatus,
  refuseWhenOthersAreInvited,
  resolveAudience,
  RICH_BODY_REFUSAL,
  toWriteFailure,
} from "../../../core/source/writer";
import type {
  CalendarSourceWriter,
  SourceEventAudience,
  SourceEventUpdate,
  SourceWriteResult,
} from "../../../core/source/writer";

const DEFAULT_GOOGLE_CALENDAR_ID = "primary";
const ISO_DATE_LENGTH = 10;

/*
 * The address the account is known by is accepted and deliberately not read. No write here
 * is decided on who an event names as its organizer: the provider's grant already answered
 * whether this account may write to the calendar, and on the CalDAV servers that sign a
 * user in by bare username there is no address to weigh an organizer against at all.
 * Refusals are decided on the attendees the writer can see, which need no identity.
 */
interface GoogleSourceWriterConfig {
  accessToken: () => Promise<string>;
  accountEmail?: string | null;
  externalCalendarId: string | null;
}

class GoogleSourceLookupError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "GoogleSourceLookupError";
    this.retryable = retryable;
  }
}

type EventLookup =
  | { error: string; retryable: boolean }
  | { event: GoogleEventWithAttendees | null };

/*
 * The lookup runs before Google is asked to change or destroy anything, so every way it
 * can fail — a typed error, an error body that is a gateway's HTML rather than JSON, a
 * response that does not match the schema, a socket that never connected — is a failure
 * that touched nothing. It has to reach the caller as an answer it can read: an exception
 * is indistinguishable from one raised after the write, and the write-back pass can only
 * release the record of a deletion it knows did not happen.
 */
const describeLookupFailure = (error: unknown): { error: string; retryable: boolean } => {
  if (error instanceof GoogleSourceLookupError) {
    return { error: error.message, retryable: error.retryable };
  }
  /*
   * A socket that never connected, a request that timed out, a body that arrived truncated:
   * the read did not happen and asking again is what settles whether it can. Nothing was
   * written either way, so retrying costs the user nothing and pausing the pair costs them
   * the edit they made.
   */
  if (error instanceof Error) {
    return { error: error.message, retryable: true };
  }
  return { error: "The Google Calendar lookup failed.", retryable: true };
};

/*
 * A source event with other people on it is a meeting, and Google notifies every one of
 * them when the organizer moves or deletes it. That notice cannot be recalled and the
 * attendee list cannot be rebuilt, so a mirrored copy is never allowed to reach it. The
 * account's own entry and the organizer's name nobody else.
 *
 * attendeesOmitted is Google saying the list in this representation is not the whole one.
 * A partial guest list read as a complete one is how an event with real guests on it comes
 * back looking like a solo appointment, so it is not weighed at all.
 */
const readEventAudience = (event: GoogleEventWithAttendees): SourceEventAudience => {
  if (event.attendeesOmitted === true) {
    return "unreadable";
  }
  return resolveAudience({
    attendees: (event.attendees ?? []).map((attendee) => ({
      address: attendee.email,
      isAccount: attendee.self,
    })),
    organizer: event.organizer?.email,
  });
};

const MARKUP_PATTERN = /<[a-z!/][^>]*>/iu;
const HTML_ENTITY_PATTERN = /&[a-z]+;|&#\d+;/iu;

/*
 * Google keeps a description as the markup it was written with; every copy Keeper.sh makes
 * of one is a plain-text projection, so the markup is nowhere but on the real event. A
 * description read back off a copy therefore cannot carry it, and writing that projection
 * over the original would drop the formatting and the hrefs — the join link a meeting
 * provider wrote in among them — with nothing anywhere to restore them from. A description
 * that carries no markup projects to itself and still travels.
 */
const carriesUnreadableMarkup = (event: GoogleEventWithAttendees): boolean => {
  const description = event.description ?? "";
  return MARKUP_PATTERN.test(description) || HTML_ENTITY_PATTERN.test(description);
};

const buildHeaders = (accessToken: string): Record<string, string> => ({
  "Authorization": `Bearer ${accessToken}`,
  "Content-Type": "application/json",
});

const resolveCalendarId = (externalCalendarId: string | null): string =>
  externalCalendarId ?? DEFAULT_GOOGLE_CALENDAR_ID;

/*
 * A deletion interrupted between the provider call and the local commit is retried, and
 * Google answers the second attempt 410 rather than 404. Reading that as a failure would
 * spend the failure budget on work that is already done and quarantine the pair forever.
 */
const isAlreadyGone = (status: number): boolean =>
  status === HTTP_STATUS.NOT_FOUND || status === GONE_STATUS;

/*
 * A refusal has to come back as a refusal. Google's front end answers a gateway failure
 * with an HTML page, and some auth failures answer with a JSON shape this schema rejects,
 * so parsing the body as the documented error is a guess that raises out of the writer
 * when it is wrong. The caller then cannot tell a write that was refused from one whose
 * outcome is unknown: the tombstone stays counted, the day's deletion budget is spent on
 * deletions that never happened, and the pair quarantines on a cap it never reached. The
 * status is what the caller is owed, and it is always available.
 */
const readErrorMessage = async (response: Response): Promise<string> => {
  const fallback = response.statusText || `HTTP ${response.status}`;
  const body = await response.text().catch(() => "");
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    return fallback;
  }
  if (!googleApiErrorSchema.allows(parsed)) {
    return fallback;
  }
  return googleApiErrorSchema.assert(parsed).error?.message ?? fallback;
};

/*
 * Google re-homes an event to the calendar's default zone when a dateTime arrives with
 * no timeZone beside it. The zone is never read back from a destination, so what travels
 * here is the source's own stored zone: a preservation, not a propagation.
 */
const buildDateField = (
  value: Date,
  isAllDay: boolean,
  startTimeZone?: string,
): { date: string } | { dateTime: string; timeZone?: string } => {
  if (isAllDay) {
    return { date: value.toISOString().slice(0, ISO_DATE_LENGTH) };
  }
  return {
    dateTime: value.toISOString(),
    ...(startTimeZone && { timeZone: startTimeZone }),
  };
};

const buildScheduleFields = (updates: SourceEventUpdate): Record<string, unknown> => {
  if (!updates.startTime && !updates.endTime) {
    return {};
  }
  if (typeof updates.isAllDay !== "boolean") {
    throw new TypeError("A Google source schedule write must carry the event's all-day flag");
  }
  const { isAllDay, startTimeZone } = updates;
  return {
    ...(updates.startTime && {
      start: buildDateField(updates.startTime, isAllDay, startTimeZone),
    }),
    ...(updates.endTime && { end: buildDateField(updates.endTime, isAllDay, startTimeZone) }),
  };
};

const createGoogleSourceWriter = (
  config: GoogleSourceWriterConfig,
): CalendarSourceWriter => {
  /*
   * A lookup that failed is not an event that is gone. Reading a throttled or erroring
   * response as an absence would report a delete that never reached Google and destroy
   * the local record of an event still sitting on the user's calendar.
   */
  const findEventByUid = async (
    accessToken: string,
    sourceEventUid: string,
    signal?: AbortSignal,
  ): Promise<GoogleEventWithAttendees | null> => {
    const url = new URL(
      `calendars/${encodeURIComponent(resolveCalendarId(config.externalCalendarId))}/events`,
      GOOGLE_CALENDAR_API,
    );
    url.searchParams.set("iCalUID", sourceEventUid);

    const response = await fetchWithTimeout(
      url,
      { headers: buildHeaders(accessToken), method: "GET" },
      TWO_WAY_SOURCE_WRITE_TIMEOUT_MS,
      signal,
    );
    if (!response.ok) {
      throw new GoogleSourceLookupError(
        await readErrorMessage(response),
        isRetryableWriteStatus(response.status),
      );
    }
    const body = googleEventWithAttendeesListSchema.assert(await response.json());
    const [item] = body.items ?? [];
    return item ?? null;
  };

  const buildEventUrl = (eventId: string): URL =>
    new URL(
      `calendars/${encodeURIComponent(resolveCalendarId(config.externalCalendarId))}`
      + `/events/${encodeURIComponent(eventId)}`,
      GOOGLE_CALENDAR_API,
    );

  /*
   * The event is read even when its id is already known, because the id alone cannot say
   * whether anyone else is on it. A read that failed is not an event with no attendees.
   */
  const findEventById = async (
    accessToken: string,
    eventId: string,
    signal?: AbortSignal,
  ): Promise<GoogleEventWithAttendees | null> => {
    const response = await fetchWithTimeout(
      buildEventUrl(eventId),
      { headers: buildHeaders(accessToken), method: "GET" },
      TWO_WAY_SOURCE_WRITE_TIMEOUT_MS,
      signal,
    );
    if (isAlreadyGone(response.status)) {
      await response.body?.cancel?.();
      return null;
    }
    if (!response.ok) {
      throw new GoogleSourceLookupError(
        await readErrorMessage(response),
        isRetryableWriteStatus(response.status),
      );
    }
    return googleEventWithAttendeesSchema.assert(await response.json());
  };

  /*
   * The token read refreshes the grant, so it fails the same ways the lookup does — a
   * revoked grant, an unreachable token endpoint, a refresh lock that could not be taken —
   * and every one of them happens before Google is asked to change anything. It has to
   * reach the caller as an answer for the same reason the lookup does: an exception is
   * indistinguishable from one raised after the write, and the write-back pass can only
   * release the record of a deletion it knows did not happen.
   */
  const resolveAccessToken = async (): Promise<
    { accessToken: string } | { error: string; retryable: boolean }
  > => {
    try {
      return { accessToken: await config.accessToken() };
    } catch (error) {
      return describeLookupFailure(error);
    }
  };

  const resolveEvent = async (
    accessToken: string,
    reference: { sourceEventId: string | null; sourceEventUid: string },
    signal?: AbortSignal,
  ): Promise<EventLookup> => {
    try {
      if (reference.sourceEventId) {
        return { event: await findEventById(accessToken, reference.sourceEventId, signal) };
      }
      return { event: await findEventByUid(accessToken, reference.sourceEventUid, signal) };
    } catch (error) {
      return describeLookupFailure(error);
    }
  };

  const resolveWritableEventId = (
    lookup: { event: GoogleEventWithAttendees | null },
    reference: { sourceEventId: string | null },
    writesDescription: boolean,
  ): { eventId: string | null } | { refusal: SourceWriteResult } => {
    const { event } = lookup;
    if (!event) {
      return { eventId: null };
    }
    const refusal = refuseWhenOthersAreInvited({
      audience: readEventAudience(event),
    });
    if (refusal) {
      return { refusal };
    }
    if (writesDescription && carriesUnreadableMarkup(event)) {
      return { refusal: RICH_BODY_REFUSAL };
    }
    return { eventId: event.id ?? reference.sourceEventId };
  };

  const updateEvent = async (
    reference: { sourceEventId: string | null; sourceEventUid: string },
    updates: SourceEventUpdate,
    signal?: AbortSignal,
  ): Promise<SourceWriteResult> => {
    const token = await resolveAccessToken();
    if ("error" in token) {
      return toWriteFailure(token.error, token.retryable);
    }
    const { accessToken } = token;
    const lookup = await resolveEvent(accessToken, reference, signal);
    if ("error" in lookup) {
      return toWriteFailure(lookup.error, lookup.retryable);
    }
    const writable = resolveWritableEventId(lookup, reference, "description" in updates);
    if ("refusal" in writable) {
      return writable.refusal;
    }
    const { eventId } = writable;
    if (!eventId) {
      return { error: "Event not found on Google Calendar.", success: false };
    }

    const patch = {
      ...("summary" in updates && { summary: updates.summary }),
      ...("description" in updates && { description: updates.description }),
      ...("location" in updates && { location: updates.location }),
      ...buildScheduleFields(updates),
    };

    const response = await fetchWithTimeout(
      buildEventUrl(eventId),
      { body: JSON.stringify(patch), headers: buildHeaders(accessToken), method: "PATCH" },
      TWO_WAY_SOURCE_WRITE_TIMEOUT_MS,
      signal,
    );
    if (!response.ok) {
      return toWriteFailure(
        await readErrorMessage(response),
        isRetryableWriteStatus(response.status),
      );
    }
    await response.body?.cancel?.();
    return { success: true };
  };

  const deleteEvent = async (
    reference: { sourceEventId: string | null; sourceEventUid: string },
    signal?: AbortSignal,
  ): Promise<SourceWriteResult> => {
    const token = await resolveAccessToken();
    if ("error" in token) {
      return toWriteFailure(token.error, token.retryable);
    }
    const { accessToken } = token;
    const lookup = await resolveEvent(accessToken, reference, signal);
    if ("error" in lookup) {
      return toWriteFailure(lookup.error, lookup.retryable);
    }
    const writable = resolveWritableEventId(lookup, reference, false);
    if ("refusal" in writable) {
      return writable.refusal;
    }
    const { eventId } = writable;
    if (!eventId) {
      return { success: true };
    }

    const response = await fetchWithTimeout(
      buildEventUrl(eventId),
      { headers: buildHeaders(accessToken), method: "DELETE" },
      TWO_WAY_SOURCE_WRITE_TIMEOUT_MS,
      signal,
    );
    if (!response.ok && !isAlreadyGone(response.status)) {
      return toWriteFailure(
        await readErrorMessage(response),
        isRetryableWriteStatus(response.status),
      );
    }
    await response.body?.cancel?.();
    return { success: true };
  };

  return { deleteEvent, updateEvent };
};

export { createGoogleSourceWriter };
export type { GoogleSourceWriterConfig };
