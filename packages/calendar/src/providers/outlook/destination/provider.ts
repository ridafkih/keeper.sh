import { HTTP_STATUS, KEEPER_CATEGORY, PROVIDER_PUSH_REQUEST_TIMEOUT_MS } from "@keeper.sh/constants";
import {
  microsoftApiErrorSchema,
  outlookEventListSchema,
  outlookEventSchema,
} from "@keeper.sh/data-schemas";
import type {
  DeleteResult,
  EventPresence,
  EventVerificationTarget,
  ListRemoteEventsOptions,
  MaterializedSyncableEvent,
  ProviderThrottleMetrics,
  PushEchoComparison,
  PushResult,
  RemoteEvent,
} from "../../../core/types";
import type { OutlookEvent } from "@keeper.sh/data-schemas";
import type { EventUpdate } from "../../../core/sync-engine/types";
import { toVerificationTarget } from "../../../core/events/verification-targets";
import { comparePushEchoObservations } from "../../../core/events/push-echo";
import type { PushEchoObservation } from "../../../core/events/push-echo";
import { getErrorMessage } from "../../../core/utils/error";
import { ensureValidToken } from "../../../core/oauth/ensure-valid-token";
import type { TokenState, TokenRefresher } from "../../../core/oauth/ensure-valid-token";
import { withBackoff } from "../../../core/utils/backoff";
import type { BackoffRetry } from "../../../core/utils/backoff";
import type { RedisRateLimiter } from "../../../core/utils/redis-rate-limiter";
import {
  getThrottleRetryDelayMs,
  isThrottledError,
  isThrottleStatus,
  OUTLOOK_MAX_THROTTLE_RETRIES,
  OutlookThrottledError,
  parseRetryAfterMs,
} from "../shared/throttle";
import { MICROSOFT_GRAPH_API, OUTLOOK_PAGE_SIZE } from "../shared/api";
import { parseEventTime } from "../shared/date-time";
import { normalizeOutlookEvent } from "./normalize-event";
import { serializeOutlookEvent } from "./serialize-event";
import { fetchWithTimeout } from "../../../core/utils/fetch-with-timeout";
import {
  createEditableEventContentSnapshot,
  hashEditableEventContentSnapshot,
} from "../../../core/events/content-hash";

interface OutlookSyncProviderConfig {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  externalCalendarId: string;
  calendarId: string;
  userId: string;
  refreshAccessToken?: TokenRefresher;
  rateLimiter?: RedisRateLimiter;
  signal?: AbortSignal;
}

/* Whether a request for this object actually left the process. The serializer runs before the
   body exists, so a refusal it raises is ours alone: recording that here is what keeps the engine
   from grading a repetition of it as the destination answering about the object. */
interface RequestAttempt {
  sent: boolean;
}

const unsentAttempt = (): RequestAttempt => ({ sent: false });

const createCaughtFailure = (error: unknown, attempt?: RequestAttempt): PushResult | DeleteResult => {
  if (isThrottledError(error)) {
    return {
      error: error.message,
      errorType: error.name,
      statusCode: error.status,
      success: false,
    };
  }
  let errorType = "UnknownError";
  if (error instanceof Error) {
    errorType = error.name;
  }
  return {
    error: getErrorMessage(error),
    errorType,
    ...(attempt?.sent === false && { requestSent: false }),
    success: false,
  };
};

const readGraphErrorMessage = async (response: Response): Promise<string> => {
  const text = await response.text();
  try {
    const parsed: unknown = JSON.parse(text);
    if (microsoftApiErrorSchema.allows(parsed)) {
      return microsoftApiErrorSchema.assert(parsed).error?.message ?? response.statusText;
    }
    return response.statusText;
  } catch {
    return response.statusText;
  }
};

const parseRemoteAvailability = (
  showAs: string | undefined,
): MaterializedSyncableEvent["availability"] => {
  if (showAs === "free" || showAs === "oof" || showAs === "workingElsewhere") {
    return showAs;
  }
  return "busy";
};

const buildOutlookEchoObservation = (resource: OutlookEvent): PushEchoObservation | null => {
  const isAllDay = resource.isAllDay ?? false;
  const startTime = parseEventTime(resource.start, isAllDay);
  const endTime = parseEventTime(resource.end, isAllDay);
  if (!startTime || !endTime) {
    return null;
  }
  return {
    content: createEditableEventContentSnapshot({
      availability: parseRemoteAvailability(resource.showAs),
      description: resource.body?.content,
      endTime,
      isAllDay,
      location: resource.location?.displayName,
      startTime,
      summary: resource.subject ?? "",
    }),
    endTime,
    startTime,
  };
};

const toOutlookRemoteEvent = (event: OutlookEvent): RemoteEvent | null => {
  const startTime = parseEventTime(event.start, event.isAllDay);
  const endTime = parseEventTime(event.end, event.isAllDay);

  if (!event.id || !event.iCalUId || !startTime || !endTime) {
    return null;
  }

  const availability = parseRemoteAvailability(event.showAs);
  const editableContent = createEditableEventContentSnapshot({
    availability,
    description: event.body?.content,
    endTime,
    isAllDay: event.isAllDay,
    location: event.location?.displayName,
    startTime,
    summary: event.subject ?? "",
  });
  return {
    deleteId: event.id,
    editableAvailability: availability,
    editableContent,
    editableContentHash: hashEditableEventContentSnapshot(editableContent),
    endTime,
    isKeeperEvent: event.categories?.includes(KEEPER_CATEGORY) ?? false,
    startTime,
    summary: event.subject ?? "",
    supportedAvailabilities: ["busy", "free", "oof", "workingElsewhere"],
    uid: event.iCalUId,
  };
};

const compareOutlookCreateEcho = (
  sent: OutlookEvent,
  echo: OutlookEvent,
): PushEchoComparison => {
  if (echo.body && echo.body.contentType !== "text") {
    return { comparable: false, reason: "echo-body-not-text" };
  }
  const echoObservation = buildOutlookEchoObservation(echo);
  const sentObservation = buildOutlookEchoObservation(sent);
  if (!echoObservation || !sentObservation) {
    return { comparable: false, reason: "echo-times-missing" };
  }
  return {
    comparable: true,
    divergence: comparePushEchoObservations(sentObservation, echoObservation),
  };
};

interface OutlookUpdateBody extends Omit<OutlookEvent, "body" | "location" | "recurrence"> {
  body: OutlookEvent["body"] | null;
  location: OutlookEvent["location"] | null;
  recurrence: OutlookEvent["recurrence"] | null;
}

const buildOutlookUpdateBody = (resource: OutlookEvent): OutlookUpdateBody => ({
  ...resource,
  body: resource.body ?? null,
  location: resource.location ?? null,
  recurrence: resource.recurrence ?? null,
});

/* Bounds a filtered uid walk so a mailbox that keeps handing back nextLinks cannot spin forever;
   exceeding it yields "unreadable" because the walk never reached the end. */
const OUTLOOK_UID_LISTING_PAGE_CAP = 100;

/* Two events under one uid name no single object, so neither of them is an observation of the
   mapped mirror and nothing about it is proven. */
const readSoleEventForUid = (events: OutlookEvent[], uid: string): OutlookEvent | null => {
  const matched = events.filter((event) => event.iCalUId === uid);
  if (matched.length !== 1) {
    return null;
  }
  return matched[0] ?? null;
};

/* A calendar Graph reports without any owner info at all: some tenants omit it for the account's
   own default calendar, so the source side keeps such a calendar rather than discarding it. */
interface MailboxCalendarEntry {
  id: string;
  ownerAddress: string | null;
}

const readCalendarOwnerAddress = (value: unknown): string | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const owner = value as { address?: unknown };
  if (typeof owner.address !== "string") {
    return null;
  }
  return owner.address;
};

const readCalendarEntriesFromPage = (body: unknown): MailboxCalendarEntry[] | null => {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const page = body as { value?: unknown };
  if (!Array.isArray(page.value)) {
    return null;
  }

  const entries: MailboxCalendarEntry[] = [];
  for (const entry of page.value) {
    if (typeof entry !== "object" || entry === null) {
      return null;
    }
    const calendar = entry as { id?: unknown; owner?: unknown };
    if (typeof calendar.id !== "string") {
      return null;
    }
    entries.push({ id: calendar.id, ownerAddress: readCalendarOwnerAddress(calendar.owner) });
  }
  return entries;
};

const isSameAddress = (left: string, right: string): boolean =>
  left.toLowerCase() === right.toLowerCase();

/* /me/calendars also hands back calendars a colleague shared or delegated to the account. This is
   the source side's rule (source/utils/list-calendars.ts): a calendar owned by a different mailbox
   is not the connected account's, and a calendar with no owner info at all is kept. */
const belongsToConnectedMailbox = (
  entry: MailboxCalendarEntry,
  mailboxAddress: string,
): boolean => {
  if (!entry.ownerAddress) {
    return true;
  }
  return isSameAddress(entry.ownerAddress, mailboxAddress);
};

const readMailboxAddressFromProfile = (body: unknown): string | null => {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const profile = body as { mail?: unknown; userPrincipalName?: unknown };
  if (typeof profile.mail === "string" && profile.mail.length > 0) {
    return profile.mail;
  }
  if (typeof profile.userPrincipalName === "string" && profile.userPrincipalName.length > 0) {
    return profile.userPrincipalName;
  }
  return null;
};

/* Graph names its query parameters with a literal "$" and hands the next page back as a link that
   carries them that way. Re-serializing the link through URLSearchParams would percent-encode those
   names, so the follow-up is rebuilt with the names as Graph wrote them and only the values escaped,
   which keeps a $skiptoken byte-for-byte the token Graph issued. */
const toGraphFollowUrl = (nextLink: string): URL => {
  const url = new URL(nextLink);
  const query: string[] = [];
  for (const [name, value] of url.searchParams) {
    query.push(`${name}=${encodeURIComponent(value)}`);
  }
  url.search = query.join("&");
  return url;
};

const readNextCalendarLink = (body: unknown): string | null => {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const page = body as { "@odata.nextLink"?: unknown };
  if (typeof page["@odata.nextLink"] !== "string") {
    return null;
  }
  return page["@odata.nextLink"];
};

const createOutlookSyncProvider = (config: OutlookSyncProviderConfig) => {
  const tokenState: TokenState = {
    accessToken: config.accessToken,
    accessTokenExpiresAt: config.accessTokenExpiresAt,
    refreshToken: config.refreshToken,
  };

  const refreshIfNeeded = async (): Promise<void> => {
    if (config.refreshAccessToken) {
      await ensureValidToken(tokenState, config.refreshAccessToken);
    }
  };

  const getHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${tokenState.accessToken}`,
    "Content-Type": "application/json",
  });

  const calendarEventsUrl = `${MICROSOFT_GRAPH_API}/me/calendars/${encodeURIComponent(config.externalCalendarId)}/events`;

  const throttleMetrics: ProviderThrottleMetrics = { retryAfterMs: 0, retryCount: 0 };

  const recordThrottleRetry = (retry: BackoffRetry): void => {
    throttleMetrics.retryCount += 1;
    throttleMetrics.retryAfterMs += retry.delayMs;
  };

  const sendRequest = async (url: URL, init: RequestInit, attempt?: RequestAttempt): Promise<Response> => {
    if (config.rateLimiter) {
      await config.rateLimiter.acquire(1, config.signal);
    }

    /* Marked on the last line before the request goes out, so everything that can still refuse
       above it - the serializer, the body encoding, the rate limiter - stays a failure that never
       left the process. */
    if (attempt) {
      attempt.sent = true;
    }
    const response = await fetchWithTimeout(
      url,
      init,
      PROVIDER_PUSH_REQUEST_TIMEOUT_MS,
      config.signal,
    );

    if (!isThrottleStatus(response.status)) {
      return response;
    }

    const retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"));
    throw new OutlookThrottledError(
      response.status,
      retryAfterMs,
      await readGraphErrorMessage(response),
    );
  };

  const sendRequestWithRetry = (url: URL, init: RequestInit, attempt?: RequestAttempt): Promise<Response> =>
    withBackoff(() => sendRequest(url, init, attempt), {
      getRetryDelayMs: getThrottleRetryDelayMs,
      maxRetries: OUTLOOK_MAX_THROTTLE_RETRIES,
      onRetry: recordThrottleRetry,
      shouldRetry: isThrottledError,
      signal: config.signal,
    });

  /* The very serialization the POST below runs, with nothing sent: an event Graph's create verb
     cannot be encoded for refuses here too, so a caller can learn that before it deletes. */
  const prepareEvent = (event: MaterializedSyncableEvent): void => {
    JSON.stringify(serializeOutlookEvent(event));
  };

  const pushEvents = async (events: MaterializedSyncableEvent[]): Promise<PushResult[]> => {
    await refreshIfNeeded();
    const results: PushResult[] = [];

    for (const event of events) {
      const attempt = unsentAttempt();
      try {
        const resource = serializeOutlookEvent(event);
        const url = new URL(calendarEventsUrl);

        const response = await sendRequestWithRetry(url, {
          body: JSON.stringify(resource),
          headers: {
            ...getHeaders(),
            Prefer: `outlook.body-content-type="text"`,
          },
          method: "POST",
        }, attempt);

        if (!response.ok) {
          results.push({
            error: await readGraphErrorMessage(response),
            errorType: "MicrosoftGraphHttpError",
            statusCode: response.status,
            success: false,
          });
          continue;
        }

        const body = await response.json();
        const created = outlookEventSchema.assert(body);
        results.push({
          deleteId: created.id,
          echo: compareOutlookCreateEcho(resource, created),
          remoteId: created.iCalUId ?? created.id,
          success: true,
        });
      } catch (error) {
        if (config.signal?.aborted) {
          throw error;
        }
        results.push(createCaughtFailure(error, attempt));
      }
    }

    return results;
  };

  const updateEvents = async (updates: EventUpdate[]): Promise<PushResult[]> => {
    await refreshIfNeeded();
    const results: PushResult[] = [];

    for (const update of updates) {
      const attempt = unsentAttempt();
      try {
        config.signal?.throwIfAborted();
        const resource = serializeOutlookEvent(update.event);
        const url = new URL(`${MICROSOFT_GRAPH_API}/me/events/${update.deleteId}`);

        const response = await sendRequestWithRetry(url, {
          body: JSON.stringify(buildOutlookUpdateBody(resource)),
          headers: {
            ...getHeaders(),
            Prefer: `outlook.body-content-type="text"`,
          },
          method: "PATCH",
        }, attempt);

        if (!response.ok) {
          results.push({
            error: await readGraphErrorMessage(response),
            errorType: "MicrosoftGraphHttpError",
            statusCode: response.status,
            success: false,
          });
          continue;
        }

        const body = await response.json();
        const updated = outlookEventSchema.assert(body);
        results.push({
          deleteId: updated.id ?? update.deleteId,
          echo: compareOutlookCreateEcho(resource, updated),
          remoteId: updated.iCalUId ?? updated.id ?? update.deleteId,
          success: true,
        });
      } catch (error) {
        if (config.signal?.aborted) {
          throw error;
        }
        results.push(createCaughtFailure(error, attempt));
      }
    }

    return results;
  };

  const deleteEvents = async (eventIds: string[]): Promise<DeleteResult[]> => {
    await refreshIfNeeded();
    const results: DeleteResult[] = [];

    for (const eventId of eventIds) {
      try {
        const url = new URL(`${MICROSOFT_GRAPH_API}/me/events/${eventId}`);

        const response = await sendRequestWithRetry(url, {
          headers: { Authorization: `Bearer ${tokenState.accessToken}` },
          method: "DELETE",
        });

        if (!response.ok && response.status !== HTTP_STATUS.NOT_FOUND) {
          results.push({
            error: await readGraphErrorMessage(response),
            errorType: "MicrosoftGraphHttpError",
            statusCode: response.status,
            success: false,
          });
          continue;
        }

        await response.body?.cancel?.();
        // A 404 means nothing was there to remove, so it carries no removal evidence.
        if (response.ok) {
          results.push({ removedObject: true, success: true });
          continue;
        }
        results.push({ success: true });
      } catch (error) {
        if (config.signal?.aborted) {
          throw error;
        }
        results.push(createCaughtFailure(error));
      }
    }

    return results;
  };

  const buildOutlookEventsUrl = (
    lookbackStart: Date,
    lookaheadEnd: Date,
    nextLink: string | null,
  ): URL => {
    if (nextLink) {
      return new URL(nextLink);
    }
    const baseUrl = new URL(calendarEventsUrl);
    baseUrl.searchParams.set(
      "$filter",
      `end/dateTime ge '${lookbackStart.toISOString()}'`
      + ` and start/dateTime le '${lookaheadEnd.toISOString()}'`,
    );
    baseUrl.searchParams.set("$top", String(OUTLOOK_PAGE_SIZE));
    baseUrl.searchParams.set(
      "$select",
      "id,iCalUId,subject,body,location,start,end,isAllDay,showAs,categories",
    );
    return baseUrl;
  };

  const listRemoteEvents = async (
    options: ListRemoteEventsOptions,
  ): Promise<RemoteEvent[]> => {
    await refreshIfNeeded();
    const remoteEvents: RemoteEvent[] = [];
    let nextLink: string | null = null;
    do {
      const url = buildOutlookEventsUrl(options.timeMin, options.timeMax, nextLink);

      const response = await sendRequestWithRetry(url, {
        headers: {
          Authorization: `Bearer ${tokenState.accessToken}`,
          Prefer: `outlook.body-content-type="text"`,
        },
        method: "GET",
      });

      if (!response.ok) {
        throw new Error(await readGraphErrorMessage(response));
      }

      const body = await response.json();
      const data = outlookEventListSchema.assert(body);

      for (const event of data.value ?? []) {
        const remoteEvent = toOutlookRemoteEvent(event);
        if (remoteEvent) {
          remoteEvents.push(remoteEvent);
        }
      }

      nextLink = data["@odata.nextLink"] ?? null;
    } while (nextLink);

    return remoteEvents;
  };

  const getRemoteEventsByIds = async (eventIds: string[]): Promise<RemoteEvent[]> => {
    await refreshIfNeeded();
    const remoteEvents: RemoteEvent[] = [];

    for (const eventId of eventIds) {
      const url = new URL(`${MICROSOFT_GRAPH_API}/me/events/${eventId}`);
      url.searchParams.set(
        "$select",
        "id,iCalUId,subject,body,location,start,end,isAllDay,showAs,categories",
      );

      const response = await sendRequestWithRetry(url, {
        headers: {
          Authorization: `Bearer ${tokenState.accessToken}`,
          Prefer: `outlook.body-content-type="text"`,
        },
        method: "GET",
      });

      if (response.status === HTTP_STATUS.NOT_FOUND) {
        await response.body?.cancel?.();
        continue;
      }

      if (!response.ok) {
        throw new Error(await readGraphErrorMessage(response));
      }

      const body = await response.json();
      const remoteEvent = toOutlookRemoteEvent(outlookEventSchema.assert(body));
      if (remoteEvent) {
        remoteEvents.push(remoteEvent);
      }
    }

    return remoteEvents;
  };

  const getThrottleMetrics = (): ProviderThrottleMetrics => ({ ...throttleMetrics });

  const readVerificationResponse = (url: URL): Promise<Response> =>
    sendRequestWithRetry(url, {
      headers: {
        Authorization: `Bearer ${tokenState.accessToken}`,
        Prefer: `outlook.body-content-type="text"`,
      },
      method: "GET",
    });

  /* A verdict that names where the item was seen but drops the item itself cannot repair anything:
     the mapping's own id is dead by the time this is reached, so the id and uid the read is holding
     at this instant are the only handles left on the customer's copy. They travel with the verdict. */
  const presenceOfObservedEvent = (
    identifier: string,
    body: unknown,
    status: "elsewhere" | "present",
  ): EventPresence => {
    if (!outlookEventSchema.allows(body)) {
      return { identifier, status: "unknown" };
    }

    const remoteEvent = toOutlookRemoteEvent(outlookEventSchema.assert(body));
    if (!remoteEvent) {
      return { identifier, status: "unknown" };
    }

    return { event: remoteEvent, identifier, status };
  };

  const presenceOfEvent = (identifier: string, body: unknown): EventPresence =>
    presenceOfObservedEvent(identifier, body, "present");

  const buildUidListingUrl = (calendarId: string, uid: string, nextLink: string | null): URL => {
    if (nextLink) {
      // Follow the link Graph handed back; re-deriving the filter here can skip past a page.
      return toGraphFollowUrl(nextLink);
    }
    const url = new URL(
      `${MICROSOFT_GRAPH_API}/me/calendars/${encodeURIComponent(calendarId)}/events`,
    );
    url.searchParams.set("$filter", `iCalUId eq '${uid.replaceAll("'", "''")}'`);
    url.searchParams.set(
      "$select",
      "id,iCalUId,subject,body,location,start,end,isAllDay,showAs,categories",
    );
    return url;
  };

  /* What the read saw, not what it returned: a listing that could not be read says nothing about the
     uid, and that has to stay separate from a listing that positively held nothing under it. */
  type UidListingObservation =
    | { kind: "unreadable" }
    | { kind: "empty" }
    | { kind: "held"; events: OutlookEvent[] };

  /* Graph does not promise a non-empty page before the last one, and this filter runs over the
     non-indexed iCalUId, which is exactly the shape that hands back an empty page carrying a
     $skiptoken. So "nothing here" is only true once the walk has reached the final page; a walk
     that broke partway saw nothing about the uid and must say so. */
  const readUidListing = async (
    calendarId: string,
    uid: string,
  ): Promise<UidListingObservation> => {
    const events: OutlookEvent[] = [];
    let nextLink: string | null = null;
    let pagesRead = 0;

    do {
      config.signal?.throwIfAborted();
      if (pagesRead >= OUTLOOK_UID_LISTING_PAGE_CAP) {
        // A walk cut short by the cap is still a partial walk, so it proves no absence.
        return { kind: "unreadable" };
      }

      const url = buildUidListingUrl(calendarId, uid, nextLink);
      const response = await readVerificationResponse(url);
      if (!response.ok) {
        await response.body?.cancel?.();
        return { kind: "unreadable" };
      }

      const body = await response.json();
      if (!outlookEventListSchema.allows(body)) {
        return { kind: "unreadable" };
      }

      events.push(...(outlookEventListSchema.assert(body).value ?? []));
      pagesRead += 1;
      nextLink = readNextCalendarLink(body);
    } while (nextLink);

    if (events.length === 0) {
      return { kind: "empty" };
    }
    return { events, kind: "held" };
  };

  const buildCalendarListUrl = (nextLink: string | null): URL => {
    if (nextLink) {
      return new URL(nextLink);
    }
    const url = new URL(`${MICROSOFT_GRAPH_API}/me/calendars`);
    /* Graph answers with exactly the fields asked for, and the owner is what separates the
       account's own folders from the ones a colleague shared into this list. */
    url.searchParams.set("$select", "id,owner");
    return url;
  };

  /* The address of the account /me names, read the way the source side learns it — from the
     account's own profile — rather than inferred from the calendar list. */
  const readProfileMailboxAddress = async (): Promise<string | null> => {
    config.signal?.throwIfAborted();
    const response = await readVerificationResponse(new URL(`${MICROSOFT_GRAPH_API}/me`));
    if (!response.ok) {
      await response.body?.cancel?.();
      return null;
    }
    return readMailboxAddressFromProfile(await response.json());
  };

  const readDestinationOwnerAddress = (entries: MailboxCalendarEntry[]): string | null => {
    const destination = entries.find((entry) => entry.id === config.externalCalendarId);
    if (!destination) {
      return null;
    }
    return destination.ownerAddress;
  };

  /* Which mailbox this verification may walk. Two independent readings name it: the profile of the
     account /me addresses, and the owner of the very folder this sync writes its mirrors into — a
     mirror dragged out of that folder can only land in another folder of the mailbox holding it.
     Where both are readable they must agree; a disagreement means a delegated destination, where
     neither reading can say which folders form one mailbox, so nothing is walked. Nothing readable
     at all is equally unanswered. Every one of those leaves absence unsettled rather than falling
     back to walking the whole list. */
  const resolveMailboxAddress = async (
    entries: MailboxCalendarEntry[],
  ): Promise<string | null> => {
    const profileAddress = await readProfileMailboxAddress();
    const destinationAddress = readDestinationOwnerAddress(entries);
    if (!profileAddress) {
      return destinationAddress;
    }
    if (!destinationAddress) {
      return profileAddress;
    }
    if (!isSameAddress(profileAddress, destinationAddress)) {
      return null;
    }
    return profileAddress;
  };

  /* A folder-scoped listing answers only about its own folder, so the mailbox's folders have to be
     enumerated before absence can mean "nowhere". A listing we could not read leaves that unanswered. */
  const readMailboxCalendarIds = async (): Promise<string[] | null> => {
    const entries: MailboxCalendarEntry[] = [];
    let nextLink: string | null = null;
    do {
      config.signal?.throwIfAborted();
      const response = await readVerificationResponse(buildCalendarListUrl(nextLink));
      if (!response.ok) {
        await response.body?.cancel?.();
        return null;
      }

      const body = await response.json();
      const page = readCalendarEntriesFromPage(body);
      if (!page) {
        return null;
      }
      entries.push(...page);
      nextLink = readNextCalendarLink(body);
    } while (nextLink);

    /* Nothing in this list claims an owner, so no calendar can be told apart from the account's
       own and the profile read would decide nothing. */
    if (entries.every((entry) => !entry.ownerAddress)) {
      return entries.map((entry) => entry.id);
    }

    const mailboxAddress = await resolveMailboxAddress(entries);
    if (!mailboxAddress) {
      return null;
    }

    return entries
      .filter((entry) => belongsToConnectedMailbox(entry, mailboxAddress))
      .map((entry) => entry.id);
  };

  /* Every target settled inside one verification call is asking about the same mailbox, so its
     folder list is read once for the whole batch instead of once per target — that multiplier is
     what turns an emptied calendar into a throttling event.

     The memo is built per call and dies with it: a folder the recipient creates between two calls
     holds a real mirror, and deciding a create against a remembered list would duplicate it
     permanently on a create-only push. An unreadable enumeration is never remembered either — it
     observed nothing about the mailbox, so it may not stand in for the folder list. */
  interface MailboxFolderMemo {
    read: () => Promise<string[] | null>;
  }

  const createMailboxFolderMemo = (): MailboxFolderMemo => {
    let pending: Promise<string[] | null> | null = null;

    const read = async (): Promise<string[] | null> => {
      if (!pending) {
        pending = readMailboxCalendarIds();
      }

      const identifiers = await pending;
      if (!identifiers) {
        pending = null;
      }
      return identifiers;
    };

    return { read };
  };

  /* Graph re-keys an item when it moves between folders of a mailbox, so the dead item id proves
     nothing on its own. The iCalUId survives the move and is the only handle that still names it.

     No single query can settle this: the destination folder's listing cannot see a mirror dragged
     out of it, and /me/events reads the mailbox default calendar, which a non-default destination
     is not. So the uid is carried across the whole mailbox and the verdict follows where it was
     found — in the destination it is present, in another folder it is still the customer's mirror
     and a create would duplicate it permanently, and nowhere at all is the only proof of absence. */
  const resolvePresenceByUid = async (
    identifier: string,
    uid: string,
    folders: MailboxFolderMemo,
  ): Promise<EventPresence> => {
    const inDestination = await readUidListing(config.externalCalendarId, uid);
    if (inDestination.kind === "unreadable") {
      return { identifier, status: "unknown" };
    }

    if (inDestination.kind === "held") {
      const matched = readSoleEventForUid(inDestination.events, uid);
      if (!matched) {
        return { identifier, status: "unknown" };
      }
      return presenceOfEvent(identifier, matched);
    }

    const calendarIds = await folders.read();
    if (!calendarIds) {
      return { identifier, status: "unknown" };
    }

    for (const calendarId of calendarIds) {
      if (calendarId === config.externalCalendarId) {
        continue;
      }

      config.signal?.throwIfAborted();
      const observation = await readUidListing(calendarId, uid);
      if (observation.kind === "unreadable") {
        return { identifier, status: "unknown" };
      }
      if (observation.kind === "held") {
        const matched = readSoleEventForUid(observation.events, uid);
        if (!matched) {
          return { identifier, status: "unknown" };
        }
        return presenceOfObservedEvent(identifier, matched, "elsewhere");
      }
    }

    // The uid named nothing in any folder of the mailbox, so the mirror is positively gone.
    return { identifier, status: "absent" };
  };

  const verifyTarget = async (
    target: EventVerificationTarget,
    folders: MailboxFolderMemo,
  ): Promise<EventPresence> => {
    const url = new URL(`${MICROSOFT_GRAPH_API}/me/events/${target.deleteId}`);
    url.searchParams.set(
      "$select",
      "id,iCalUId,subject,body,location,start,end,isAllDay,showAs,categories",
    );

    const response = await readVerificationResponse(url);
    if (response.ok) {
      return presenceOfEvent(target.deleteId, await response.json());
    }

    await response.body?.cancel?.();
    // A refusal is not an observation of the object, so it can never stand in for its absence.
    if (response.status !== HTTP_STATUS.NOT_FOUND) {
      return { identifier: target.deleteId, status: "unknown" };
    }

    if (!target.uid) {
      return { identifier: target.deleteId, status: "unknown" };
    }

    return await resolvePresenceByUid(target.deleteId, target.uid, folders);
  };

  const verifyEventsExist = async (
    targets: (EventVerificationTarget | string)[],
  ): Promise<EventPresence[]> => {
    await refreshIfNeeded();
    const report: EventPresence[] = [];
    const folders = createMailboxFolderMemo();

    for (const entry of targets) {
      config.signal?.throwIfAborted();

      const target = toVerificationTarget(entry);
      try {
        report.push(await verifyTarget(target, folders));
      } catch (error) {
        if (config.signal?.aborted) {
          throw error;
        }
        // A read that failed tells us nothing about the object, so it leaves the mirror unproven.
        report.push({ identifier: target.deleteId, status: "unknown" });
      }
    }

    return report;
  };

  return {
    deleteEvents,
    getRemoteEventsByIds,
    getThrottleMetrics,
    listRemoteEvents,
    normalizeEvent: normalizeOutlookEvent,
    prepareEvent,
    pushEvents,
    updateEvents,
    verifyEventsExist,
  };
};

export { createOutlookSyncProvider };
export type { OutlookSyncProviderConfig };
