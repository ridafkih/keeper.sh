import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOutlookSyncProvider } from "../../../src/providers/outlook/destination/provider";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";
import type { MaterializedSyncableEvent, PushResult, SyncOperation } from "../../../src/core/types";
import type { CalendarSyncProvider, PendingChanges, PendingUpdate } from "../../../src/core/sync-engine/types";
import type { EventMapping } from "../../../src/core/events/mappings";

const DESTINATION_CALENDAR_ID = "cal-1";
const DESTINATION_FOLDER_ID = "external-cal-1";
const DEFAULT_FOLDER_ID = "the-mailbox-default-calendar";

const START_TIME = new Date("2026-09-01T15:00:00.000Z");
const END_TIME = new Date("2026-09-01T16:00:00.000Z");

/* The customer's only copy on the destination. Every assertion in this file is about whether this
   identifier survives a destination that will not say anything about it. */
const LIVE_MIRROR_ID = "AAMkAG-live-mirror";
const MIRROR_UID = "mirror-uid-1";
const MAPPING_ID = "mapping-1";

const MAPPED_SUBJECT = "Quarterly review";
const EDITED_SUBJECT = "Quarterly review — moved to Thursday";

/* The unsettled tally has to live somewhere that survives to the next cycle, and it may not be the
   field the answered-refusal accumulator writes, or either kind of evidence tops the other up. */
type CarriedMapping = EventMapping & { consecutiveUnsettledReads?: number };
type CarriedUpdate = PendingUpdate & { consecutiveUnsettledReads?: number };

interface GraphRequest {
  body: string | null;
  method: string;
  url: string;
}

type VerificationMode = "folder-read-throws" | "mirror-is-absent";

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

const readPathSegments = (url: URL): string[] =>
  url.pathname.split("/").filter((segment) => segment.length > 0);

const isCalendarListRead = (url: URL): boolean => readPathSegments(url).at(-1) === "calendars";

const readRequestBody = (init?: RequestInit): string | null => {
  if (typeof init?.body !== "string") {
    return null;
  }
  return init.body;
};

/* A synthetic Graph mailbox holding the customer's live mirror. In "folder-read-throws" the folder
   listing the uid walk needs blows up, which is what Outlook does for EVERY target the moment one
   folder read fails or is throttled: the verdict comes back "unknown" through the provider's own
   catch, never as a hand-written literal. */
const installGraphMailbox = (mode: VerificationMode): GraphRequest[] => {
  const requests: GraphRequest[] = [];

  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";
    requests.push({ body: readRequestBody(init), method, url: url.toString() });

    if (method === "DELETE") {
      // The item really is there, so Graph removes it and the provider reports removal evidence.
      return Promise.resolve(new Response(null, { status: 204 }));
    }

    if (method === "POST") {
      return Promise.resolve(Response.json(makeGraphEvent("AAMkAG-duplicate", "duplicate-uid")));
    }

    if (isCalendarListRead(url)) {
      if (mode === "folder-read-throws") {
        return Promise.reject(new Error("the folder listing failed"));
      }
      return Promise.resolve(Response.json({
        value: [{ id: DESTINATION_FOLDER_ID }, { id: DEFAULT_FOLDER_ID }],
      }));
    }

    // The mapped identifier is dead, so the verdict can only come from the uid walk above.
    if (url.searchParams.has("$filter")) {
      return Promise.resolve(Response.json({ value: [] }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
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

const baseMapping: CarriedMapping = {
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

const toReplacement = (mapping: CarriedMapping): SyncOperation => ({
  deleteId: mapping.deleteIdentifier,
  event: localEvent,
  staleMappingId: mapping.id,
  type: "replace",
  uid: mapping.destinationEventUid,
});

/* The serializer refused the update, so nothing ever left the process and the destination never had
   a say. No number of repetitions can turn that into evidence about the customer's copy. */
const refusedBeforeSending: PushResult = {
  error: "the event could not be serialized for the update verb",
  errorType: "EventSerializationError",
  requestSent: false,
  success: false,
};

/* Graph answered about this object and rejected it. Durable evidence -- but only ever evidence that
   the update fails, never that the mirror may be destroyed. */
const answeredWithFourHundred: PushResult = {
  error: "Graph rejected the update",
  errorType: "MicrosoftGraphHttpError",
  requestSent: true,
  statusCode: 400,
  success: false,
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

interface ProviderSpies {
  deleteCalls: string[][];
  provider: CalendarSyncProvider;
  verifyCalls: number;
}

/* The real Outlook provider throughout -- its prepareEvent, its deleteEvents, its pushEvents and,
   except where a cycle is explicitly throttled, its verifyEventsExist. Only the update verb is
   replaced, because the whole case starts with an update that fails. */
const createSpiedProvider = (
  pushResult: PushResult,
  readThrottled: boolean,
): ProviderSpies => {
  const real = createRealProvider();
  const deleteCalls: string[][] = [];
  const spies: ProviderSpies = { deleteCalls, provider: real, verifyCalls: 0 };

  const verifyEventsExist: NonNullable<CalendarSyncProvider["verifyEventsExist"]> = async (targets) => {
    spies.verifyCalls += 1;
    if (readThrottled) {
      throw new Error("read throttled: 429");
    }
    const verify = real.verifyEventsExist;
    if (!verify) {
      throw new TypeError("Expected the Outlook provider to expose verifyEventsExist");
    }
    return await verify(targets);
  };

  spies.provider = {
    ...real,
    deleteEvents: (eventIds: string[]) => {
      deleteCalls.push([...eventIds]);
      return real.deleteEvents(eventIds);
    },
    updateEvents: (updates) => Promise.resolve(updates.map(() => pushResult)),
    verifyEventsExist,
  };

  return spies;
};

interface CycleOutcome {
  addFailed: number;
  deleteCalls: string[][];
  deletes: GraphRequest[];
  nextMapping: CarriedMapping;
  parked: number;
  posts: GraphRequest[];
  unsettledTally: number | undefined;
  verifyCalls: number;
}

const lastCarriedUpdate = (
  outcomeUpdates: PendingUpdate[],
  checkpointedUpdates: PendingUpdate[],
): CarriedUpdate | undefined => {
  const carried = [...outcomeUpdates, ...checkpointedUpdates] as CarriedUpdate[];
  return carried.findLast((update) => update.id === MAPPING_ID);
};

const carryMappingForward = (
  mapping: CarriedMapping,
  carried: CarriedUpdate | undefined,
): CarriedMapping => {
  if (!carried) {
    return mapping;
  }
  return {
    ...mapping,
    ...(typeof carried.consecutiveUpdateFailures === "number"
      && { consecutiveUpdateFailures: carried.consecutiveUpdateFailures }),
    ...(typeof carried.consecutiveUnsettledReads === "number"
      && { consecutiveUnsettledReads: carried.consecutiveUnsettledReads }),
    deleteIdentifier: carried.deleteIdentifier ?? mapping.deleteIdentifier,
  };
};

const requestsOfMethod = (requests: GraphRequest[], method: string): GraphRequest[] =>
  requests.filter((request) => request.method === method);

const runCycle = async (
  mapping: CarriedMapping,
  requests: GraphRequest[],
  pushResult: PushResult,
  readThrottled: boolean,
): Promise<CycleOutcome> => {
  const before = requests.length;
  const checkpointed: PendingChanges[] = [];
  const spies = createSpiedProvider(pushResult, readThrottled);

  const outcome = await executeRemoteOperations(
    [toReplacement(mapping)],
    [mapping],
    DESTINATION_CALENDAR_ID,
    spies.provider,
    globalThis.undefined,
    globalThis.undefined,
    (changes: PendingChanges) => {
      checkpointed.push(changes);
      return Promise.resolve(true);
    },
  );

  const made = requests.slice(before);
  const checkpointedUpdates = checkpointed.flatMap((changes) => changes.updates ?? []);
  const carried = lastCarriedUpdate(outcome.changes.updates ?? [], checkpointedUpdates);

  return {
    addFailed: outcome.result.addFailed,
    deleteCalls: spies.deleteCalls,
    deletes: requestsOfMethod(made, "DELETE"),
    nextMapping: carryMappingForward(mapping, carried),
    parked: outcome.result.parked ?? 0,
    posts: requestsOfMethod(made, "POST"),
    unsettledTally: carried?.consecutiveUnsettledReads,
    verifyCalls: spies.verifyCalls,
  };
};

describe("an unsettled read never licenses a delete, and each kind of evidence counts itself", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never deletes the mirror while the read keeps answering unknown", async () => {
    const requests = installGraphMailbox("folder-read-throws");
    let mapping = baseMapping;

    for (let cycle = 0; cycle < 5; cycle++) {
      const outcome = await runCycle(mapping, requests, refusedBeforeSending, false);
      /* A destination declining to answer is not evidence about the customer's copy, so it can
         never license destroying it -- on any cycle, at any counter value. */
      expect({ cycle, deleteCalls: outcome.deleteCalls }).toEqual({ cycle, deleteCalls: [] });
      expect({ cycle, deletes: outcome.deletes }).toEqual({ cycle, deletes: [] });
      // Outlook's push is a create-only POST, so a create here is a permanent duplicate.
      expect({ cycle, posts: outcome.posts }).toEqual({ cycle, posts: [] });
      mapping = outcome.nextMapping;
    }
  });

  it("does not let answered refusals top up the evidence an unknown read is allowed to spend", async () => {
    const requests = installGraphMailbox("folder-read-throws");
    let mapping = baseMapping;

    /* Two ordinary Graph 400s, driven rather than planted: real history on the answered route. */
    for (let cycle = 0; cycle < 2; cycle++) {
      const answered = await runCycle(mapping, requests, answeredWithFourHundred, false);
      expect({ cycle, verifyCalls: answered.verifyCalls }).toEqual({ cycle, verifyCalls: 0 });
      mapping = answered.nextMapping;
    }
    expect(mapping.consecutiveUpdateFailures).toBe(2);

    const firstUnknown = await runCycle(mapping, requests, refusedBeforeSending, false);

    expect(firstUnknown.verifyCalls).toBe(1);
    expect(firstUnknown.deleteCalls).toEqual([]);
    expect(firstUnknown.deletes).toEqual([]);
    expect(firstUnknown.posts).toEqual([]);
  });

  it("counts unsettled reads on their own tally and parks the mapping until the read answers", async () => {
    const requests = installGraphMailbox("folder-read-throws");
    let mapping = baseMapping;
    const unsettledTallies: (number | undefined)[] = [];

    for (let cycle = 0; cycle < 6; cycle++) {
      const outcome = await runCycle(mapping, requests, answeredWithFourHundred, true);
      if (outcome.verifyCalls > 0) {
        unsettledTallies.push(outcome.unsettledTally);
        /* A mapping nobody can act on must be named and counted as parked, never as an actionable
           failure: graded failed it pins the whole calendar at the six-hour backoff ceiling. */
        expect({ cycle, parked: outcome.parked }).toEqual({ cycle, parked: 1 });
        expect({ cycle, actionable: outcome.addFailed - outcome.parked })
          .toEqual({ cycle, actionable: 0 });
      }
      expect({ cycle, deleteCalls: outcome.deleteCalls }).toEqual({ cycle, deleteCalls: [] });
      expect({ cycle, posts: outcome.posts }).toEqual({ cycle, posts: [] });
      mapping = outcome.nextMapping;
    }

    /* The tally must advance, not oscillate: a promotion spending the answered counter must not be
       read back as the unsettled one. */
    expect(unsettledTallies.slice(0, 3)).toEqual([1, 2, 3]);

    vi.unstubAllGlobals();
    const answeringRequests = installGraphMailbox("mirror-is-absent");
    const restored = await runCycle(mapping, answeringRequests, answeredWithFourHundred, false);

    /* Parking is the state while the destination stays mute, not the resting place of the event:
       the cycle the read finally answers absent, the mirror comes back. */
    expect(restored.verifyCalls).toBe(1);
    expect(restored.posts).toHaveLength(1);
    expect(restored.deleteCalls).toEqual([]);
    expect(restored.deletes).toEqual([]);
  });
});
