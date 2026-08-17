import {
  microsoftApiErrorSchema,
  outlookEventWithAttendeesListSchema,
  outlookEventWithAttendeesSchema,
} from "@keeper.sh/data-schemas";
import type {
  OutlookEventWithAttendees } from "@keeper.sh/data-schemas";
import { HTTP_STATUS, TWO_WAY_SOURCE_WRITE_TIMEOUT_MS } from "@keeper.sh/constants";
import { fetchWithTimeout } from "../../../core/utils/fetch-with-timeout";
import { instantToWallTime } from "../../../ics/utils/timezone-instant";
import {
  attemptSourceWrite,
  isRetryableOAuthWriteStatus,
  refuseWhenOutOfReach,
  resolveAudience,
  resolveAuthorship,
  RICH_BODY_REFUSAL,
  toWriteFailure,
} from "../../../core/source/writer";
import type {
  CalendarSourceWriter,
  SourceEventAudience,
  SourceEventAuthorship,
  SourceEventUpdate,
  SourceWriteResult,
  WriteBackReach,
} from "../../../core/source/writer";

const MICROSOFT_GRAPH_API = "https://graph.microsoft.com/v1.0";
const SINGLE_RESULT = "1";

/*
 * The address the account is known by, weighed against the address Graph names as the
 * event's organizer — which on a mailbox somebody else owns is that person. Where the
 * address is missing the question has no answer and no write is refused for it.
 */
interface OutlookSourceWriterConfig {
  accessToken: () => Promise<string>;
  accountEmail?: string | null;
  writeBackReach?: WriteBackReach;
}

class OutlookSourceLookupError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "OutlookSourceLookupError";
    this.retryable = retryable;
  }
}

type EventLookup =
  | { error: string; retryable: boolean }
  | { event: OutlookEventWithAttendees | null };

/*
 * The lookup runs before Outlook is asked to change or destroy anything, so every way it
 * can fail — a typed error, an error body that is a gateway's HTML rather than JSON, a
 * response that does not match the schema, a socket that never connected — is a failure
 * that touched nothing. It has to reach the caller as an answer it can read: an exception
 * is indistinguishable from one raised after the write, and the write-back pass can only
 * release the record of a deletion it knows did not happen.
 */
const describeLookupFailure = (error: unknown): { error: string; retryable: boolean } => {
  if (error instanceof OutlookSourceLookupError) {
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
  return { error: "The Outlook lookup failed.", retryable: true };
};

/*
 * Graph sends a meeting update to every attendee when the organizer changes an event, and
 * a cancellation to every one of them when the organizer deletes it. Neither notice can be
 * recalled, so a mirrored copy is never allowed to reach an event that carries guests. The
 * organizer's own entry is not one: Outlook writes the organizer into the attendee list of
 * anything that was ever a meeting, and a write to an event whose only entry is that one
 * notifies nobody.
 */
const readEventAudience = (event: OutlookEventWithAttendees): SourceEventAudience =>
  resolveAudience({
    attendees: (event.attendees ?? []).map((attendee) => ({
      address: attendee.emailAddress?.address,
    })),
    organizer: event.organizer?.emailAddress?.address,
  });

/*
 * Graph says with isOrganizer that the account holding this copy is the one that put the
 * event there. It is believed when it says yes; a missing yes settles nothing, and the
 * organizer address decides the rest — where either address is absent, nothing is refused.
 */
const readEventAuthorship = (
  event: OutlookEventWithAttendees,
  accountEmail: string | null | undefined,
): SourceEventAuthorship =>
  resolveAuthorship({
    account: accountEmail,
    author: event.organizer?.emailAddress?.address,
    ...(typeof event.isOrganizer === "boolean" && { isAccount: event.isOrganizer }),
  });

const HTML_BODY_CONTENT_TYPE = "html";
const MARKUP_PATTERN = /<[^>]*>/gu;
const HTML_ENTITY_PATTERN = /&[a-z]+;|&#\d+;/giu;
const EMPTY_LENGTH = 0;

/*
 * An html body Graph reports as empty of text and of anchors carries nothing a plain-text
 * write could destroy, so the description still travels there. Anything else is treated as
 * markup Keeper.sh never held: every body it reads arrives rendered to text, so it cannot
 * tell a bolded word from an unbolded one, and a write would replace both with the text.
 */
const carriesUnreadableMarkup = (event: OutlookEventWithAttendees): boolean => {
  const { body } = event;
  if (!body || body.contentType !== HTML_BODY_CONTENT_TYPE) {
    return false;
  }
  const content = body.content ?? "";
  const text = content
    .replaceAll(MARKUP_PATTERN, " ")
    .replaceAll(HTML_ENTITY_PATTERN, " ")
    .trim();
  return text.length > EMPTY_LENGTH || content.includes("<a ") || content.includes("<img");
};

const buildHeaders = (accessToken: string): Record<string, string> => ({
  "Authorization": `Bearer ${accessToken}`,
  "Content-Type": "application/json",
});

/*
 * A refusal has to come back as a refusal. Graph answers a gateway failure with an HTML
 * page, and some auth failures answer with a JSON shape this schema rejects, so parsing
 * the body as the documented error is a guess that raises out of the writer when it is
 * wrong. The caller then cannot tell a write that was refused from one whose outcome is
 * unknown: the tombstone stays counted, the day's deletion budget is spent on deletions
 * that never happened, and the pair quarantines on a cap it never reached. The status is
 * what the caller is owed, and it is always available.
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
  if (!microsoftApiErrorSchema.allows(parsed)) {
    return fallback;
  }
  return microsoftApiErrorSchema.assert(parsed).error?.message ?? fallback;
};

const UTC_TIME_ZONE = "UTC";

/*
 * Graph reads dateTime as a wall clock inside timeZone, so a UTC instant sent beside the
 * source's own zone would move the event. The zone is never read back from a destination:
 * what travels here is the source's own stored zone, a preservation rather than a
 * propagation. An all-day event is stored at midnight UTC and Graph requires it to start
 * at midnight in whatever zone accompanies it, so it keeps travelling as UTC.
 */
const resolveWriteTimeZone = (updates: SourceEventUpdate, isAllDay: boolean): string => {
  if (isAllDay) {
    return UTC_TIME_ZONE;
  }
  return updates.startTimeZone ?? UTC_TIME_ZONE;
};

const buildDateTimeField = (
  value: Date,
  timeZone: string,
): { dateTime: string; timeZone: string } => ({
  dateTime: instantToWallTime(value, timeZone).toISOString().replace("Z", ""),
  timeZone,
});

const buildScheduleFields = (updates: SourceEventUpdate): Record<string, unknown> => {
  if (!updates.startTime && !updates.endTime) {
    return {};
  }
  if (typeof updates.isAllDay !== "boolean") {
    throw new TypeError("An Outlook source schedule write must carry the event's all-day flag");
  }
  const { isAllDay } = updates;
  const timeZone = resolveWriteTimeZone(updates, isAllDay);
  return {
    isAllDay,
    ...(updates.startTime && { start: buildDateTimeField(updates.startTime, timeZone) }),
    ...(updates.endTime && { end: buildDateTimeField(updates.endTime, timeZone) }),
  };
};

/*
 * Whoever invites the user picks the UID of the event that lands on their calendar, so a
 * quote in it would close the filter's literal and let the rest of the UID name a
 * different event for the update or the delete to land on.
 */
const quoteODataLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;

const createOutlookSourceWriter = (
  config: OutlookSourceWriterConfig,
): CalendarSourceWriter => {
  /*
   * A lookup that failed is not an event that is gone. Reading a throttled or erroring
   * response as an absence would report a delete that never reached Graph and destroy the
   * local record of an event still sitting on the user's calendar.
   */
  const findEventByUid = async (
    accessToken: string,
    sourceEventUid: string,
    signal?: AbortSignal,
  ): Promise<OutlookEventWithAttendees | null> => {
    const url = new URL(`${MICROSOFT_GRAPH_API}/me/events`);
    url.searchParams.set("$filter", `iCalUId eq ${quoteODataLiteral(sourceEventUid)}`);
    url.searchParams.set("$top", SINGLE_RESULT);

    const response = await fetchWithTimeout(
      url,
      { headers: buildHeaders(accessToken), method: "GET" },
      TWO_WAY_SOURCE_WRITE_TIMEOUT_MS,
      signal,
    );
    if (!response.ok) {
      throw new OutlookSourceLookupError(
        await readErrorMessage(response),
        isRetryableOAuthWriteStatus(response.status),
      );
    }
    const body = outlookEventWithAttendeesListSchema.assert(await response.json());
    const [item] = body.value ?? [];
    return item ?? null;
  };

  /*
   * The event is read even when its id is already known, because the id alone cannot say
   * whether anyone else is on it. A read that failed is not an event with no attendees.
   */
  const findEventById = async (
    accessToken: string,
    eventId: string,
    signal?: AbortSignal,
  ): Promise<OutlookEventWithAttendees | null> => {
    const response = await fetchWithTimeout(
      new URL(`${MICROSOFT_GRAPH_API}/me/events/${eventId}`),
      { headers: buildHeaders(accessToken), method: "GET" },
      TWO_WAY_SOURCE_WRITE_TIMEOUT_MS,
      signal,
    );
    if (response.status === HTTP_STATUS.NOT_FOUND) {
      await response.body?.cancel?.();
      return null;
    }
    if (!response.ok) {
      throw new OutlookSourceLookupError(
        await readErrorMessage(response),
        isRetryableOAuthWriteStatus(response.status),
      );
    }
    return outlookEventWithAttendeesSchema.assert(await response.json());
  };

  /*
   * The token read refreshes the grant, so it fails the same ways the lookup does — a
   * revoked grant, an unreachable token endpoint, a refresh lock that could not be taken —
   * and every one of them happens before Graph is asked to change anything. It has to
   * reach the caller as an answer for the same reason the lookup does.
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
    lookup: { event: OutlookEventWithAttendees | null },
    reference: { sourceEventId: string | null },
    write: { isDelete: boolean; updates?: SourceEventUpdate },
  ): { eventId: string | null } | { refusal: SourceWriteResult } => {
    const { event } = lookup;
    if (!event) {
      return { eventId: null };
    }
    const refusal = refuseWhenOutOfReach({
      audience: readEventAudience(event),
      authorship: readEventAuthorship(event, config.accountEmail),
      isDelete: write.isDelete,
      updates: write.updates,
    }, config.writeBackReach ?? "own_events");
    if (refusal) {
      return { refusal };
    }
    if (write.updates && "description" in write.updates && carriesUnreadableMarkup(event)) {
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
    const writable = resolveWritableEventId(lookup, reference, { isDelete: false, updates });
    if ("refusal" in writable) {
      return writable.refusal;
    }
    const { eventId } = writable;
    if (!eventId) {
      return { error: "Event not found on Outlook.", success: false };
    }

    const patch = {
      ...("summary" in updates && { subject: updates.summary }),
      ...("description" in updates && {
        body: { content: updates.description, contentType: "text" },
      }),
      ...("location" in updates && { location: { displayName: updates.location } }),
      ...buildScheduleFields(updates),
    };

    const sent = await attemptSourceWrite(
      () => fetchWithTimeout(
        new URL(`${MICROSOFT_GRAPH_API}/me/events/${eventId}`),
        {
          body: JSON.stringify(patch),
          headers: buildHeaders(accessToken),
          method: "PATCH",
        },
        TWO_WAY_SOURCE_WRITE_TIMEOUT_MS,
        signal,
      ),
      "The edit to Outlook never got an answer.",
    );
    if ("failure" in sent) {
      return sent.failure;
    }
    const response = sent.sent;
    if (!response.ok) {
      return toWriteFailure(
        await readErrorMessage(response),
        isRetryableOAuthWriteStatus(response.status),
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
    const writable = resolveWritableEventId(lookup, reference, { isDelete: true });
    if ("refusal" in writable) {
      return writable.refusal;
    }
    const { eventId } = writable;
    if (!eventId) {
      return { success: true };
    }

    const sent = await attemptSourceWrite(
      () => fetchWithTimeout(
        new URL(`${MICROSOFT_GRAPH_API}/me/events/${eventId}`),
        { headers: buildHeaders(accessToken), method: "DELETE" },
        TWO_WAY_SOURCE_WRITE_TIMEOUT_MS,
        signal,
      ),
      "The deletion on Outlook never got an answer.",
    );
    if ("failure" in sent) {
      return sent.failure;
    }
    const response = sent.sent;
    if (!response.ok && response.status !== HTTP_STATUS.NOT_FOUND) {
      return toWriteFailure(
        await readErrorMessage(response),
        isRetryableOAuthWriteStatus(response.status),
      );
    }
    await response.body?.cancel?.();
    return { success: true };
  };

  return { deleteEvent, updateEvent };
};

export { createOutlookSourceWriter };
export type { OutlookSourceWriterConfig };
