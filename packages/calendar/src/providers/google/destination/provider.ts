import { generateDeterministicEventUid, isKeeperEvent } from "../../../core/events/identity";
import { toVerificationTarget } from "../../../core/events/verification-targets";
import { ensureValidToken } from "../../../core/oauth/ensure-valid-token";
import type { TokenState, TokenRefresher } from "../../../core/oauth/ensure-valid-token";
import type { RedisRateLimiter } from "../../../core/utils/redis-rate-limiter";
import type {
  DeleteResult,
  DestinationAnswer,
  EventPresence,
  EventVerificationTarget,
  ListRemoteEventsOptions,
  MaterializedSyncableEvent,
  PushEchoComparison,
  PushResult,
  RemoteEvent,
} from "../../../core/types";
import {
  googleApiErrorSchema,
  googleEventListSchema,
  googleEventSchema,
} from "@keeper.sh/data-schemas";
import type { GoogleEvent } from "@keeper.sh/data-schemas";
import { HTTP_STATUS, PROVIDER_PUSH_REQUEST_TIMEOUT_MS } from "@keeper.sh/constants";
import { fetchWithTimeout } from "../../../core/utils/fetch-with-timeout";
import { GOOGLE_CALENDAR_API, GOOGLE_CALENDAR_MAX_RESULTS, GONE_STATUS } from "../shared/api";
import { withBackoff } from "../../../core/utils/backoff";
import { executeBatchChunked } from "../shared/batch";
import { isRateLimitApiError, parseGoogleApiError } from "../shared/errors";
import type { BatchSubRequest, BatchSubResponse } from "../shared/batch";
import type { EventUpdate } from "../../../core/sync-engine/types";
import { parseEventTime } from "../shared/date-time";
import { normalizeGoogleEvent } from "./normalize-event";
import { serializeGoogleEvent } from "./serialize-event";
import {
  createEditableEventContentSnapshot,
  hashEditableEventContentSnapshot,
} from "../../../core/events/content-hash";
import { comparePushEchoObservations } from "../../../core/events/push-echo";
import type { PushEchoObservation } from "../../../core/events/push-echo";

interface GoogleSyncProviderConfig {
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

class GoogleCalendarApiError extends Error {
  public readonly status: number;
  public readonly apiError: ReturnType<typeof parseGoogleApiError>;
  constructor(status: number, body: string) {
    super(`Google Calendar API ${status}: ${body}`);
    this.name = "GoogleCalendarApiError";
    this.status = status;
    this.apiError = parseGoogleApiError(body);
  }
}

const isDirectEventId = (identifier: string): boolean => !identifier.includes("@");

const extractBatchErrorMessage = (body: unknown, fallbackStatus: number): string => {
  const fallback = `Batch sub-request failed with status ${fallbackStatus}`;
  if (!googleApiErrorSchema.allows(body)) {
    return fallback;
  }
  return googleApiErrorSchema.assert(body).error?.message ?? fallback;
};

const parseGoogleAvailability = (
  resource: GoogleEvent,
): MaterializedSyncableEvent["availability"] => {
  if (resource.transparency === "transparent") {
    return "free";
  }
  return "busy";
};

const buildGoogleEchoObservation = (resource: GoogleEvent): PushEchoObservation | null => {
  const startTime = parseEventTime(resource.start);
  const endTime = parseEventTime(resource.end);
  if (!startTime || !endTime) {
    return null;
  }
  return {
    content: createEditableEventContentSnapshot({
      availability: parseGoogleAvailability(resource),
      description: resource.description,
      endTime,
      isAllDay: Boolean(resource.start?.date),
      location: resource.location,
      startTime,
      summary: resource.summary ?? "",
    }),
    endTime,
    startTime,
  };
};

/* Google answers a read for a recipient-deleted event with HTTP 200 and a tombstone carrying
   status "cancelled" rather than a 404, so a cancelled resource is evidence of absence, never a mirror. */
const isCancelledGoogleEvent = (event: GoogleEvent): boolean => event.status === "cancelled";

const toGoogleRemoteEvent = (event: GoogleEvent): RemoteEvent | null => {
  if (isCancelledGoogleEvent(event)) {
    return null;
  }
  if (!event.iCalUID || !isKeeperEvent(event.iCalUID)) {
    return null;
  }
  const observation = buildGoogleEchoObservation(event);
  if (!observation) {
    return null;
  }
  return {
    deleteId: event.id ?? event.iCalUID,
    editableAvailability: parseGoogleAvailability(event),
    editableContent: observation.content,
    editableContentHash: hashEditableEventContentSnapshot(observation.content),
    endTime: observation.endTime,
    isKeeperEvent: true,
    startTime: observation.startTime,
    supportedAvailabilities: ["busy", "free"],
    uid: event.iCalUID,
  };
};

const compareGoogleImportEcho =(sent: GoogleEvent, body: unknown): PushEchoComparison => {
  if (!googleEventSchema.allows(body)) {
    return { comparable: false, reason: "echo-not-parseable" };
  }
  const echoObservation = buildGoogleEchoObservation(googleEventSchema.assert(body));
  const sentObservation = buildGoogleEchoObservation(sent);
  if (!echoObservation || !sentObservation) {
    return { comparable: false, reason: "echo-times-missing" };
  }
  return {
    comparable: true,
    divergence: comparePushEchoObservations(sentObservation, echoObservation),
  };
};

const buildUpdateBody = (resource: GoogleEvent): GoogleEvent => {
  const body = { ...resource };
  delete body.iCalUID;
  return body;
};

const getEchoedICalUid = (body: unknown): string | null => {
  if (typeof body !== "object" || body === null || !("iCalUID" in body)) {
    return null;
  }
  if (typeof body.iCalUID !== "string" || body.iCalUID.length === 0) {
    return null;
  }
  return body.iCalUID;
};

const getImportedEventId = (body: unknown): string | null => {
  if (typeof body !== "object" || body === null || !("id" in body)) {
    return null;
  }
  if (typeof body.id !== "string" || body.id.length === 0) {
    return null;
  }
  return body.id;
};

/*
 * Whether Google itself said anything about this object. The batch parser is the only place that
 * knows: it either read a real status line for this index or it did not. A status of 0 is what a
 * part that never arrived is filled in with, so it is the absence of an answer, never one.
 */
const observedAnswer = (response: BatchSubResponse): DestinationAnswer => {
  if (response.answer) {
    return response.answer;
  }
  if (response.statusCode > 0) {
    return "answered";
  }
  return "unanswered";
};

const createImportResult = (
  deleteId: string | null,
  remoteId: string,
  statusCode: number,
  echo: PushEchoComparison,
): PushResult => {
  if (deleteId) {
    return { deleteId, echo, remoteId, success: true };
  }
  return {
    error: "Google import response is missing the event ID",
    errorType: "GoogleBatchProtocolError",
    statusCode,
    success: false,
  };
};

type DeleteLookupResolution =
  | { kind: "absent" }
  | { eventId: string; kind: "found" }
  | { kind: "failed"; result: DeleteResult };

const resolveDeleteLookup = (response: BatchSubResponse | undefined): DeleteLookupResolution => {
  if (!response) {
    return {
      kind: "failed",
      result: {
        error: "Missing batch response for Google event lookup",
        errorType: "GoogleBatchProtocolError",
        success: false,
      },
    };
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    return {
      kind: "failed",
      result: {
        error: extractBatchErrorMessage(response.body, response.statusCode),
        errorType: "GoogleCalendarApiError",
        statusCode: response.statusCode,
        success: false,
      },
    };
  }

  if (!googleEventListSchema.allows(response.body)) {
    return {
      kind: "failed",
      result: {
        error: "Invalid Google event lookup response",
        errorType: "GoogleBatchProtocolError",
        statusCode: response.statusCode,
        success: false,
      },
    };
  }

  const items = googleEventListSchema.assert(response.body).items ?? [];
  if (items.length === 0) {
    return { kind: "absent" };
  }

  if (items.length !== 1 || !items[0]?.id) {
    let error = `Google event lookup returned ${items.length} matching events`;
    if (items.length === 1) {
      error = "Google event lookup response is missing the event ID";
    }
    return {
      kind: "failed",
      result: {
        error,
        errorType: "GoogleBatchProtocolError",
        statusCode: response.statusCode,
        success: false,
      },
    };
  }

  return { eventId: items[0].id, kind: "found" };
};

const createGoogleSyncProvider = (config: GoogleSyncProviderConfig) => {
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

  const eventsPath = `/calendar/v3/calendars/${encodeURIComponent(config.externalCalendarId)}/events`;

  // Writes go through events.import, which upserts by iCalUID: re-pushing an existing event updates it rather than 409ing.
  const buildPushRequest = (
    event: MaterializedSyncableEvent,
  ): { uid: string; resource: GoogleEvent; request: BatchSubRequest } | null => {
    const uid = generateDeterministicEventUid(`${event.id}:${config.externalCalendarId}`);
    const resource = serializeGoogleEvent(event, uid);
    if (!resource) {
      return null;
    }
    return {
      uid,
      resource,
      request: {
        method: "POST",
        path: `${eventsPath}/import`,
        headers: { "Content-Type": "application/json" },
        body: resource,
      },
    };
  };

  /* The create-side sub-request pushEvents would batch, built and discarded, so an event Google's
     import verb cannot be serialized for is known before anything is deleted for it. */
  const prepareEvent = (event: MaterializedSyncableEvent): void => {
    buildPushRequest(event);
  };

  const pushEvents = async (events: MaterializedSyncableEvent[]): Promise<PushResult[]> => {
    await refreshIfNeeded();

    const results: PushResult[] = Array.from({ length: events.length });
    const pending: {
      index: number;
      uid: string;
      resource: GoogleEvent;
      batchIndex: number;
    }[] = [];
    const requests: BatchSubRequest[] = [];

    for (let index = 0; index < events.length; index++) {
      const event = events[index];
      if (!event) {
        results[index] = { success: true };
        continue;
      }

      const built = buildPushRequest(event);
      if (!built) {
        results[index] = { success: true };
        continue;
      }

      pending.push({
        index,
        uid: built.uid,
        resource: built.resource,
        batchIndex: requests.length,
      });
      requests.push(built.request);
    }

    if (requests.length === 0) {
      return results;
    }

    const responses = await executeBatchChunked(requests, tokenState.accessToken, { rateLimiter: config.rateLimiter, signal: config.signal, timeoutMs: PROVIDER_PUSH_REQUEST_TIMEOUT_MS });

    for (const entry of pending) {
      const response = responses[entry.batchIndex];
      if (!response) {
        results[entry.index] = {
          error: "Missing batch response",
          errorType: "GoogleBatchProtocolError",
          success: false,
        };
      } else if (response.statusCode >= 200 && response.statusCode < 300) {
        const deleteId = getImportedEventId(response.body);
        results[entry.index] = createImportResult(
          deleteId,
          entry.uid,
          response.statusCode,
          compareGoogleImportEcho(entry.resource, response.body),
        );
      } else {
        results[entry.index] = {
          destinationAnswer: observedAnswer(response),
          error: extractBatchErrorMessage(response.body, response.statusCode),
          errorType: "GoogleCalendarApiError",
          statusCode: response.statusCode,
          success: false,
        };
      }
    }

    return results;
  };

  const buildUpdateRequest = (
    update: EventUpdate,
  ): { uid: string; resource: GoogleEvent; request: BatchSubRequest } | null => {
    if (!isDirectEventId(update.deleteId)) {
      const importResource = serializeGoogleEvent(update.event, update.deleteId);
      if (!importResource) {
        return null;
      }
      return {
        uid: update.deleteId,
        resource: importResource,
        request: {
          method: "POST",
          path: `${eventsPath}/import`,
          headers: { "Content-Type": "application/json" },
          body: importResource,
        },
      };
    }

    const uid = generateDeterministicEventUid(`${update.event.id}:${config.externalCalendarId}`);
    const resource = serializeGoogleEvent(update.event, uid);
    if (!resource) {
      return null;
    }
    return {
      uid,
      resource,
      request: {
        method: "PUT",
        path: `${eventsPath}/${encodeURIComponent(update.deleteId)}`,
        headers: { "Content-Type": "application/json" },
        body: buildUpdateBody(resource),
      },
    };
  };

  const updateEvents = async (updates: EventUpdate[]): Promise<PushResult[]> => {
    await refreshIfNeeded();

    const results: PushResult[] = Array.from({ length: updates.length });
    const pending: {
      index: number;
      uid: string;
      resource: GoogleEvent;
      batchIndex: number;
    }[] = [];
    const requests: BatchSubRequest[] = [];

    for (let index = 0; index < updates.length; index++) {
      const update = updates[index];
      if (!update) {
        results[index] = { success: true };
        continue;
      }

      const built = buildUpdateRequest(update);
      if (!built) {
        results[index] = { success: true };
        continue;
      }

      pending.push({
        index,
        uid: built.uid,
        resource: built.resource,
        batchIndex: requests.length,
      });
      requests.push(built.request);
    }

    if (requests.length === 0) {
      return results;
    }

    const responses = await executeBatchChunked(requests, tokenState.accessToken, { rateLimiter: config.rateLimiter, signal: config.signal, timeoutMs: PROVIDER_PUSH_REQUEST_TIMEOUT_MS });

    for (const entry of pending) {
      const response = responses[entry.batchIndex];
      if (!response) {
        results[entry.index] = {
          error: "Missing batch response",
          errorType: "GoogleBatchProtocolError",
          success: false,
        };
      } else if (response.statusCode >= 200 && response.statusCode < 300) {
        results[entry.index] = createImportResult(
          getImportedEventId(response.body),
          getEchoedICalUid(response.body) ?? entry.uid,
          response.statusCode,
          compareGoogleImportEcho(entry.resource, response.body),
        );
      } else {
        results[entry.index] = {
          destinationAnswer: observedAnswer(response),
          error: extractBatchErrorMessage(response.body, response.statusCode),
          errorType: "GoogleCalendarApiError",
          statusCode: response.statusCode,
          success: false,
        };
      }
    }

    return results;
  };

  const resolveDeleteRequests = async (
    eventIds: string[],
    results: DeleteResult[],
  ): Promise<{ subRequests: BatchSubRequest[]; indexMap: number[] }> => {
    const directSubRequests: BatchSubRequest[] = [];
    const directIndexMap: number[] = [];
    const lookupIds: string[] = [];
    const lookupOriginalIndices: number[] = [];

    for (let index = 0; index < eventIds.length; index++) {
      const identifier = eventIds[index];
      if (!identifier) {
        results[index] = { success: true };
        continue;
      }

      if (isDirectEventId(identifier)) {
        directIndexMap.push(index);
        directSubRequests.push({
          method: "DELETE",
          path: `${eventsPath}/${encodeURIComponent(identifier)}`,
        });
      } else {
        lookupIds.push(identifier);
        lookupOriginalIndices.push(index);
      }
    }

    if (lookupIds.length === 0) {
      return { subRequests: directSubRequests, indexMap: directIndexMap };
    }

    const findSubRequests: BatchSubRequest[] = lookupIds.map((uid) => ({
      method: "GET",
      path: `${eventsPath}?iCalUID=${encodeURIComponent(uid)}`,
    }));

    const findResponses = await executeBatchChunked(findSubRequests, tokenState.accessToken, { rateLimiter: config.rateLimiter, signal: config.signal, timeoutMs: PROVIDER_PUSH_REQUEST_TIMEOUT_MS });

    for (let findIndex = 0; findIndex < lookupIds.length; findIndex++) {
      const originalIndex = lookupOriginalIndices[findIndex];
      if (typeof originalIndex !== "number") {
        continue;
      }

      const resolution = resolveDeleteLookup(findResponses[findIndex]);
      if (resolution.kind === "failed") {
        results[originalIndex] = resolution.result;
        continue;
      }
      if (resolution.kind === "absent") {
        results[originalIndex] = { success: true };
        continue;
      }

      directIndexMap.push(originalIndex);
      directSubRequests.push({
        method: "DELETE",
        path: `${eventsPath}/${encodeURIComponent(resolution.eventId)}`,
      });
    }

    return { subRequests: directSubRequests, indexMap: directIndexMap };
  };

  const deleteEvents = async (eventIds: string[]): Promise<DeleteResult[]> => {
    await refreshIfNeeded();

    if (eventIds.length === 0) {
      return [];
    }

    const results: DeleteResult[] = Array.from({ length: eventIds.length });
    const { subRequests, indexMap } = await resolveDeleteRequests(eventIds, results);

    if (subRequests.length === 0) {
      return results;
    }

    const deleteResponses = await executeBatchChunked(subRequests, tokenState.accessToken, { rateLimiter: config.rateLimiter, signal: config.signal, timeoutMs: PROVIDER_PUSH_REQUEST_TIMEOUT_MS });

    for (let deleteIndex = 0; deleteIndex < deleteResponses.length; deleteIndex++) {
      const originalIndex = indexMap[deleteIndex];
      if (typeof originalIndex !== "number") {
        continue;
      }

      const deleteResponse = deleteResponses[deleteIndex];
      if (!deleteResponse) {
        results[originalIndex] = {
          error: "Missing batch response",
          errorType: "GoogleBatchProtocolError",
          success: false,
        };
        continue;
      }

      if (deleteResponse.statusCode >= 200 && deleteResponse.statusCode < 300) {
        results[originalIndex] = { removedObject: true, success: true };
      } else if (deleteResponse.statusCode === HTTP_STATUS.NOT_FOUND || deleteResponse.statusCode === GONE_STATUS) {
        // 404 (never existed) and 410 (already deleted) both mean the event is gone — the desired end state.
        results[originalIndex] = { success: true };
      } else {
        const errorMessage = extractBatchErrorMessage(deleteResponse.body, deleteResponse.statusCode);
        results[originalIndex] = {
          error: errorMessage,
          errorType: "GoogleCalendarApiError",
          statusCode: deleteResponse.statusCode,
          success: false,
        };
      }
    }

    return results;
  };

  const fetchRemoteEventsPage = async (
    options: ListRemoteEventsOptions,
    pageToken: string | null,
  ): Promise<{
    items: RemoteEvent[];
    nextPageToken: string | null;
  }> => {
    if (config.rateLimiter) {
      await config.rateLimiter.acquire(1, config.signal);
    }

    const url = new URL(
      `calendars/${encodeURIComponent(config.externalCalendarId)}/events`,
      GOOGLE_CALENDAR_API,
    );
    url.searchParams.set("maxResults", String(GOOGLE_CALENDAR_MAX_RESULTS));
    url.searchParams.set("timeMin", options.timeMin.toISOString());
    url.searchParams.set("timeMax", options.timeMax.toISOString());
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await fetchWithTimeout(
      url,
      {
        headers: { Authorization: `Bearer ${tokenState.accessToken}` },
        method: "GET",
      },
      PROVIDER_PUSH_REQUEST_TIMEOUT_MS,
      config.signal,
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new GoogleCalendarApiError(response.status, errorBody);
    }

    const body = await response.json();
    const data = googleEventListSchema.assert(body);

    const items: RemoteEvent[] = [];
    for (const event of data.items ?? []) {
      const remoteEvent = toGoogleRemoteEvent(event);
      if (remoteEvent) {
        items.push(remoteEvent);
      }
    }

    return { items, nextPageToken: data.nextPageToken ?? null };
  };

  const listRemoteEvents = async (
    options: ListRemoteEventsOptions,
  ): Promise<RemoteEvent[]> => {
    await refreshIfNeeded();
    const remoteEvents: RemoteEvent[] = [];
    let pageToken: string | null = null;

    do {
      const currentPageToken: string | null = pageToken;
      const page: { items: RemoteEvent[]; nextPageToken: string | null } = await withBackoff(
        () => fetchRemoteEventsPage(options, currentPageToken),
        {
          signal: config.signal,
          shouldRetry: (error) =>
            error instanceof GoogleCalendarApiError && isRateLimitApiError(error.status, error.apiError),
        },
      );
      remoteEvents.push(...page.items);
      pageToken = page.nextPageToken;
    } while (pageToken);

    return remoteEvents;
  };

  const buildTargetedReadRequest = (identifier: string): BatchSubRequest => {
    if (isDirectEventId(identifier)) {
      return { method: "GET", path: `${eventsPath}/${encodeURIComponent(identifier)}` };
    }
    // A legacy mapping holds the iCalUID, which Google only resolves through the list query.
    return { method: "GET", path: `${eventsPath}?iCalUID=${encodeURIComponent(identifier)}` };
  };

  const readDirectEvent = (response: BatchSubResponse): RemoteEvent[] => {
    if (
      response.statusCode === HTTP_STATUS.NOT_FOUND
      || response.statusCode === GONE_STATUS
    ) {
      return [];
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new GoogleCalendarApiError(response.statusCode, JSON.stringify(response.body));
    }

    const remoteEvent = toGoogleRemoteEvent(googleEventSchema.assert(response.body));
    if (!remoteEvent) {
      return [];
    }
    return [remoteEvent];
  };

  const readLegacyLookup = (response: BatchSubResponse): RemoteEvent[] => {
    // Absence here must be proven by an empty item list, never inferred from a status.
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new GoogleCalendarApiError(response.statusCode, JSON.stringify(response.body));
    }

    const remoteEvents: RemoteEvent[] = [];
    for (const event of googleEventListSchema.assert(response.body).items ?? []) {
      const remoteEvent = toGoogleRemoteEvent(event);
      if (remoteEvent) {
        remoteEvents.push(remoteEvent);
      }
    }
    return remoteEvents;
  };

  const readTargetedResponse = (identifier: string, response: BatchSubResponse): RemoteEvent[] => {
    if (isDirectEventId(identifier)) {
      return readDirectEvent(response);
    }
    return readLegacyLookup(response);
  };

  /* The key itself is dead. That is all this status proves: the object behind it may be deleted,
     or it may be alive under a new id after an import, a move or a restore re-keyed it. */
  const isDeadKeyRead = (response: BatchSubResponse): boolean =>
    response.statusCode === HTTP_STATUS.NOT_FOUND || response.statusCode === GONE_STATUS;

  const presenceOfDirectRead = (identifier: string, response: BatchSubResponse): EventPresence => {
    if (isDeadKeyRead(response)) {
      return { identifier, status: "absent" };
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      return { identifier, status: "unknown" };
    }

    if (!googleEventSchema.allows(response.body)) {
      return { identifier, status: "unknown" };
    }

    const resource = googleEventSchema.assert(response.body);
    if (isCancelledGoogleEvent(resource)) {
      return { identifier, status: "absent" };
    }

    const remoteEvent = toGoogleRemoteEvent(resource);
    if (!remoteEvent) {
      return { identifier, status: "unknown" };
    }

    return { event: remoteEvent, identifier, status: "present" };
  };

  const presenceOfLegacyLookup = (identifier: string, response: BatchSubResponse): EventPresence => {
    // Absence here is proven by an empty item list, never inferred from a status.
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return { identifier, status: "unknown" };
    }

    if (!googleEventListSchema.allows(response.body)) {
      return { identifier, status: "unknown" };
    }

    const items = googleEventListSchema.assert(response.body).items ?? [];
    /* Every occurrence of a recurring series carries the master's iCalUID, so this list can hold
       several entries in unspecified order. Reading only the first one would call a live series
       absent, or point a repair at an instance rather than the master; an ambiguous read is
       "unknown", which repairs, creates and deletes nothing. */
    if (items.length > 1) {
      return { identifier, status: "unknown" };
    }

    const [item] = items;
    if (!item || isCancelledGoogleEvent(item)) {
      return { identifier, status: "absent" };
    }

    const remoteEvent = toGoogleRemoteEvent(item);
    if (!remoteEvent) {
      return { identifier, status: "unknown" };
    }

    return { event: remoteEvent, identifier, status: "present" };
  };

  const presenceOfResponse = (
    identifier: string,
    response: BatchSubResponse | undefined,
  ): EventPresence => {
    if (!response) {
      return { identifier, status: "unknown" };
    }
    if (isDirectEventId(identifier)) {
      return presenceOfDirectRead(identifier, response);
    }
    return presenceOfLegacyLookup(identifier, response);
  };

  const buildUidLookupRequest = (uid: string): BatchSubRequest => ({
    method: "GET",
    path: `${eventsPath}?iCalUID=${encodeURIComponent(uid)}`,
  });

  /* An id read that came back 404 has only proved that the key is dead, and on Google a key dies
     for two very different reasons: the event was deleted, or an import, a move between calendars
     or a restore re-keyed it and the customer's copy is still sitting there under the same
     iCalUID. Absence is the one verdict that licenses a create with nothing else asked, so it has
     to be earned against the uid the mapping names -- otherwise a re-key turns into a second
     permanent copy of an event the customer already has. */
  const needsUidConfirmation = (
    target: EventVerificationTarget,
    response: BatchSubResponse | undefined,
  ): boolean => {
    if (!response || !isDeadKeyRead(response)) {
      /* Any other answer observed the object itself - a cancelled tombstone included, which is the
         id still resolving to a resource Google marked deleted. Nothing there is stale. */
      return false;
    }
    if (!target.uid) {
      return false;
    }
    // A legacy mapping was already read by its uid, so the lookup would only ask the same question.
    return isDirectEventId(target.deleteId);
  };

  const confirmAbsencesByUid = async (
    targets: EventVerificationTarget[],
    presences: EventPresence[],
    responses: (BatchSubResponse | undefined)[],
  ): Promise<EventPresence[]> => {
    const pending: { index: number; target: EventVerificationTarget }[] = [];
    const requests: BatchSubRequest[] = [];

    for (let index = 0; index < targets.length; index++) {
      const target = targets[index];
      if (!target || !needsUidConfirmation(target, responses[index])) {
        continue;
      }
      const { uid } = target;
      if (!uid) {
        continue;
      }
      pending.push({ index, target });
      requests.push(buildUidLookupRequest(uid));
    }

    if (requests.length === 0) {
      return presences;
    }

    const lookups = await executeBatchChunked(requests, tokenState.accessToken, { rateLimiter: config.rateLimiter, signal: config.signal, timeoutMs: PROVIDER_PUSH_REQUEST_TIMEOUT_MS });

    const confirmed = [...presences];
    for (let position = 0; position < pending.length; position++) {
      const entry = pending[position];
      if (!entry) {
        continue;
      }
      const response = lookups[position];
      if (!response) {
        // The lookup never answered, so the id read's absence stays unproven rather than standing.
        confirmed[entry.index] = { identifier: entry.target.deleteId, status: "unknown" };
        continue;
      }
      /* The lookup is scoped to the destination calendar, so whatever it names is a mirror this
         sync owns and the verdict is keyed by the identifier the mapping still holds. */
      confirmed[entry.index] = presenceOfLegacyLookup(entry.target.deleteId, response);
    }

    return confirmed;
  };

  const verifyEventsExist = async (
    targets: (EventVerificationTarget | string)[],
  ): Promise<EventPresence[]> => {
    await refreshIfNeeded();

    const verificationTargets = targets.map((target) => toVerificationTarget(target));

    if (verificationTargets.length === 0) {
      return [];
    }

    // One batched request per chunk, so verifying a whole destination costs a handful of requests.
    const requests: BatchSubRequest[] = verificationTargets.map((target) => buildTargetedReadRequest(target.deleteId));

    const responses = await executeBatchChunked(requests, tokenState.accessToken, { rateLimiter: config.rateLimiter, signal: config.signal, timeoutMs: PROVIDER_PUSH_REQUEST_TIMEOUT_MS });

    const presences = verificationTargets.map(
      (target, index) => presenceOfResponse(target.deleteId, responses[index]),
    );

    return await confirmAbsencesByUid(verificationTargets, presences, responses);
  };

  const getRemoteEventsByIds = async (eventIds: string[]): Promise<RemoteEvent[]> => {
    await refreshIfNeeded();

    if (eventIds.length === 0) {
      return [];
    }

    const requests: BatchSubRequest[] = eventIds.map((eventId) => buildTargetedReadRequest(eventId));

    const responses = await executeBatchChunked(requests, tokenState.accessToken, { rateLimiter: config.rateLimiter, signal: config.signal, timeoutMs: PROVIDER_PUSH_REQUEST_TIMEOUT_MS });

    const remoteEvents: RemoteEvent[] = [];
    for (let index = 0; index < eventIds.length; index++) {
      const identifier = eventIds[index];
      if (!identifier) {
        continue;
      }

      const response = responses[index];
      if (!response) {
        throw new Error("Missing batch response for Google event lookup");
      }

      remoteEvents.push(...readTargetedResponse(identifier, response));
    }

    return remoteEvents;
  };

  return {
    deleteEvents,
    getRemoteEventsByIds,
    listRemoteEvents,
    normalizeEvent: normalizeGoogleEvent,
    prepareEvent,
    pushEvents,
    updateEvents,
    verifyEventsExist,
  };
};

export { createGoogleSyncProvider };
export type { GoogleSyncProviderConfig };
