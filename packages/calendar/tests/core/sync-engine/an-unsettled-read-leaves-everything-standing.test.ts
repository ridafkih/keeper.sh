import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOutlookSyncProvider } from "../../../src/providers/outlook/destination/provider";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";
import type {
  EventPresence,
  MaterializedSyncableEvent,
  PushResult,
  SyncOperation,
} from "../../../src/core/types";
import type { CalendarSyncProvider, PendingChanges } from "../../../src/core/sync-engine/types";
import type { EventMapping } from "../../../src/core/events/mappings";

const DESTINATION_CALENDAR_ID = "cal-1";
const DESTINATION_FOLDER_ID = "external-cal-1";

const START_TIME = new Date("2026-09-01T15:00:00.000Z");
const END_TIME = new Date("2026-09-01T16:00:00.000Z");

const LIVE_MIRROR_ID = "AAMkAG-live-mirror";
const RELOCATED_MIRROR_ID = "AAMkAG-relocated-mirror";
const MIRROR_UID = "mirror-uid-1";
const MAPPING_ID = "mapping-1";

const MAPPED_SUBJECT = "Quarterly review";
const EDITED_SUBJECT = "Quarterly review — moved to Thursday";

type ReadFailure = "incomplete-page" | "omits-verdict" | "refused" | "throttled";

interface GraphRequest {
  body: string | null;
  method: string;
  url: string;
}

const makeGraphEvent = (id: string, iCalUId: string) => ({
  categories: [KEEPER_CATEGORY],
  end: { dateTime: "2026-09-01T16:00:00.0000000", timeZone: "UTC" },
  iCalUId,
  id,
  isAllDay: false,
  showAs: "busy",
  start: { dateTime: "2026-09-01T15:00:00.0000000", timeZone: "UTC" },
  subject: MAPPED_SUBJECT,
});

const readRequestBody = (init?: RequestInit): string | null => {
  if (typeof init?.body !== "string") {
    return null;
  }
  return init.body;
};

const isUidListingRead = (url: URL): boolean => url.searchParams.has("$filter");

const isMappedIdentifierRead = (url: URL): boolean => url.pathname.endsWith(`/events/${LIVE_MIRROR_ID}`);

const incompletePage = (pageNumber: number): Response =>
  Response.json({
    "@odata.nextLink": `https://graph.microsoft.com/v1.0/me/calendars/${DESTINATION_FOLDER_ID}/events?$skiptoken=page-${pageNumber}`,
    value: [],
  });

const liveMirrorId = (failure: ReadFailure): string => {
  if (failure === "refused" || failure === "throttled") {
    return LIVE_MIRROR_ID;
  }
  return RELOCATED_MIRROR_ID;
};

const throttledResponse = (): Response =>
  Response.json({ error: { code: "TooManyRequests", message: "throttled" } }, {
    headers: { "Retry-After": "0" },
    status: 429,
  });

const installGraphMailbox = (failure: ReadFailure): GraphRequest[] => {
  const requests: GraphRequest[] = [];
  let pagesServed = 0;

  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";
    requests.push({ body: readRequestBody(init), method, url: url.toString() });

    if (method === "DELETE") {
      if (url.pathname.endsWith(`/events/${liveMirrorId(failure)}`)) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    }

    if (method === "POST") {
      return Promise.resolve(Response.json(makeGraphEvent("AAMkAG-duplicate", "duplicate-uid")));
    }

    if (failure === "throttled") {
      return Promise.resolve(throttledResponse());
    }

    if (failure === "refused") {
      return Promise.resolve(Response.json(
        { error: { code: "InternalServerError", message: "no observation" } },
        { status: 500 },
      ));
    }

    if (isMappedIdentifierRead(url)) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }

    if (isUidListingRead(url)) {
      if (failure === "incomplete-page") {
        pagesServed += 1;
        return Promise.resolve(incompletePage(pagesServed));
      }
      return Promise.resolve(Response.json({
        value: [makeGraphEvent(RELOCATED_MIRROR_ID, MIRROR_UID)],
      }));
    }

    return Promise.resolve(Response.json({ value: [{ id: DESTINATION_FOLDER_ID }] }));
  }));

  return requests;
};

const localEvent: MaterializedSyncableEvent = {
  calendarId: "source-cal-1",
  calendarName: "Work",
  calendarUrl: null,
  endTime: END_TIME,
  id: "sync-event-1",
  sourceEventUid: "source-uid-1",
  startTime: START_TIME,
  summary: EDITED_SUBJECT,
};

const mappedEvent: MaterializedSyncableEvent = { ...localEvent, summary: MAPPED_SUBJECT };

const mapping: EventMapping = {
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: LIVE_MIRROR_ID,
  destinationEventUid: MIRROR_UID,
  endTime: END_TIME,
  eventStateId: "sync-event-1",
  id: MAPPING_ID,
  sourceCalendarId: "source-cal-1",
  startTime: START_TIME,
  syncEventHash: createSyncEventContentHash(mappedEvent),
  syncEventId: "sync-event-1",
};

const replacement: SyncOperation = {
  deleteId: LIVE_MIRROR_ID,
  event: localEvent,
  staleMappingId: MAPPING_ID,
  type: "replace",
  uid: MIRROR_UID,
};

const updateTargetGone: PushResult = {
  error: "The specified object was not found in the store.",
  errorType: "MicrosoftGraphHttpError",
  requestSent: true,
  statusCode: 404,
  success: false,
};

const acceptedUpdate: PushResult = {
  deleteId: LIVE_MIRROR_ID,
  remoteId: MIRROR_UID,
  requestSent: true,
  success: true,
};

const createRealProvider = (): CalendarSyncProvider =>
  createOutlookSyncProvider({
    accessToken: "test-token",
    refreshToken: "test-refresh",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    externalCalendarId: DESTINATION_FOLDER_ID,
    calendarId: DESTINATION_CALENDAR_ID,
    userId: "user-1",
  });

const withVerdictOmitted = (
  verify: NonNullable<CalendarSyncProvider["verifyEventsExist"]>,
): NonNullable<CalendarSyncProvider["verifyEventsExist"]> => async (targets) => {
  const report = await verify(targets);
  return (report as EventPresence[]).filter((entry) => entry.identifier !== LIVE_MIRROR_ID);
};

const verificationFor = (
  verify: NonNullable<CalendarSyncProvider["verifyEventsExist"]>,
  failure: ReadFailure,
): NonNullable<CalendarSyncProvider["verifyEventsExist"]> => {
  if (failure === "omits-verdict") {
    return withVerdictOmitted(verify);
  }
  return verify;
};

interface ProviderSpies {
  deleteCalls: string[][];
  provider: CalendarSyncProvider;
}

const createSpiedProvider = (pushResult: PushResult, failure: ReadFailure): ProviderSpies => {
  const real = createRealProvider();
  const deleteCalls: string[][] = [];
  const verify = real.verifyEventsExist;
  if (!verify) {
    throw new TypeError("Expected the Outlook provider to expose verifyEventsExist");
  }

  const provider: CalendarSyncProvider = {
    ...real,
    deleteEvents: (eventIds: string[]) => {
      deleteCalls.push([...eventIds]);
      return real.deleteEvents(eventIds);
    },
    updateEvents: (updates) => Promise.resolve(updates.map(() => pushResult)),
    verifyEventsExist: verificationFor(verify, failure),
  };

  return { deleteCalls, provider };
};

interface CycleOutcome {
  added: number;
  addFailed: number;
  deleteCalls: string[][];
  deletes: GraphRequest[];
  mappingDeletes: string[];
  parked: number;
  posts: GraphRequest[];
  verificationUnsettled: number;
}

const requestsOfMethod = (requests: GraphRequest[], method: string): GraphRequest[] =>
  requests.filter((request) => request.method === method);

const runCycle = async (
  requests: GraphRequest[],
  pushResult: PushResult,
  failure: ReadFailure,
): Promise<CycleOutcome> => {
  const spies = createSpiedProvider(pushResult, failure);

  const outcome = await executeRemoteOperations(
    [replacement],
    [mapping],
    DESTINATION_CALENDAR_ID,
    spies.provider,
    globalThis.undefined,
    globalThis.undefined,
    (_changes: PendingChanges) => Promise.resolve(true),
  );

  return {
    added: outcome.result.added,
    addFailed: outcome.result.addFailed,
    deleteCalls: spies.deleteCalls,
    deletes: requestsOfMethod(requests, "DELETE"),
    mappingDeletes: outcome.changes.deletes,
    parked: outcome.result.parked ?? 0,
    posts: requestsOfMethod(requests, "POST"),
    verificationUnsettled: outcome.verificationUnsettled,
  };
};

const READ_FAILURES: ReadFailure[] = ["throttled", "refused", "incomplete-page", "omits-verdict"];

describe("an unsettled read leaves everything standing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(READ_FAILURES)("creates nothing and deletes nothing when the read is %s", async (failure) => {
    const requests = installGraphMailbox(failure);

    const outcome = await runCycle(requests, updateTargetGone, failure);

    expect({ deleteCalls: outcome.deleteCalls, failure }).toEqual({ deleteCalls: [], failure });
    expect({ deletes: outcome.deletes, failure }).toEqual({ deletes: [], failure });
    expect({ failure, posts: outcome.posts }).toEqual({ failure, posts: [] });
    expect({ added: outcome.added, failure }).toEqual({ added: 0, failure });
    expect({ failure, mappingDeletes: outcome.mappingDeletes }).toEqual({ failure, mappingDeletes: [] });
  });

  it.each(READ_FAILURES)("reports the %s read as unsettled rather than as a healthy run", async (failure) => {
    const requests = installGraphMailbox(failure);

    const outcome = await runCycle(requests, updateTargetGone, failure);

    expect({ failure, verificationUnsettled: outcome.verificationUnsettled })
      .toEqual({ failure, verificationUnsettled: 1 });
    expect({ failure, parked: outcome.parked }).toEqual({ failure, parked: 1 });
    expect({ actionable: outcome.addFailed - outcome.parked, failure })
      .toEqual({ actionable: 0, failure });
  });

  it("reports nothing unsettled and nothing parked when the destination answers", async () => {
    const requests = installGraphMailbox("throttled");

    const outcome = await runCycle(requests, acceptedUpdate, "throttled");

    expect({
      addFailed: outcome.addFailed,
      parked: outcome.parked,
      verificationUnsettled: outcome.verificationUnsettled,
    }).toEqual({ addFailed: 0, parked: 0, verificationUnsettled: 0 });
    expect(outcome.deletes).toEqual([]);
    expect(outcome.posts).toEqual([]);
  });
});
