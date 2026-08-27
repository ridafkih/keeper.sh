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

const LIVE_MIRROR_ID = "AAMkAG-live-mirror";
const MIRROR_UID = "mirror-uid-1";
const MAPPING_ID = "mapping-1";

const MAPPED_SUBJECT = "Quarterly review";
const EDITED_SUBJECT = "Quarterly review — moved to Thursday";

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

const installGraphMailbox = (mode: VerificationMode): GraphRequest[] => {
  const requests: GraphRequest[] = [];

  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";
    requests.push({ body: readRequestBody(init), method, url: url.toString() });

    if (method === "DELETE") {
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

const refusedBeforeSending: PushResult = {
  error: "the event could not be serialized for the update verb",
  errorType: "EventSerializationError",
  requestSent: false,
  success: false,
};

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
      expect({ cycle, deleteCalls: outcome.deleteCalls }).toEqual({ cycle, deleteCalls: [] });
      expect({ cycle, deletes: outcome.deletes }).toEqual({ cycle, deletes: [] });
      expect({ cycle, posts: outcome.posts }).toEqual({ cycle, posts: [] });
      mapping = outcome.nextMapping;
    }
  });

  it("does not let answered refusals top up the evidence an unknown read is allowed to spend", async () => {
    const requests = installGraphMailbox("folder-read-throws");
    let mapping = baseMapping;

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
        expect({ cycle, parked: outcome.parked }).toEqual({ cycle, parked: 1 });
        expect({ cycle, actionable: outcome.addFailed - outcome.parked })
          .toEqual({ cycle, actionable: 0 });
      }
      expect({ cycle, deleteCalls: outcome.deleteCalls }).toEqual({ cycle, deleteCalls: [] });
      expect({ cycle, posts: outcome.posts }).toEqual({ cycle, posts: [] });
      mapping = outcome.nextMapping;
    }

    expect(unsettledTallies.slice(0, 3)).toEqual([1, 2, 3]);

    vi.unstubAllGlobals();
    const answeringRequests = installGraphMailbox("mirror-is-absent");
    const restored = await runCycle(mapping, answeringRequests, answeredWithFourHundred, false);

    expect(restored.verifyCalls).toBe(1);
    expect(restored.posts).toHaveLength(1);
    expect(restored.deleteCalls).toEqual([]);
    expect(restored.deletes).toEqual([]);
  });
});
