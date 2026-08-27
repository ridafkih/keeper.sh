import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOutlookSyncProvider } from "../../../src/providers/outlook/destination/provider";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";
import type {
  DeleteResult,
  EventPresence,
  EventVerificationTarget,
  MaterializedSyncableEvent,
  PushResult,
} from "../../../src/core/types";
import type {
  CalendarSyncProvider,
  EventUpdate,
  PendingChanges,
  PendingUpdate,
} from "../../../src/core/sync-engine/types";
import type { EventMapping } from "../../../src/core/events/mappings";

const DOUBLE_CALENDAR_ID = "dest-cal-a";
const DOUBLE_START_TIME = new Date("2026-05-11T09:00:00.000Z");
const DOUBLE_END_TIME = new Date("2026-05-11T10:00:00.000Z");

const DOUBLE_MAPPING_ID = "map-a1";
const DOUBLE_MAPPED_ID = "mirror-as-mapped-a1";
const DOUBLE_RELOCATED_ID = "mirror-at-its-new-id-a1";
const DOUBLE_MIRROR_UID = "mirror-uid-a1";

const DOUBLE_SCOPE = {
  authoritativeWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
  requestedWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
};

const mappedDoubleEvent: MaterializedSyncableEvent = {
  calendarId: "source-cal-a",
  calendarName: "Work",
  calendarUrl: null,
  endTime: DOUBLE_END_TIME,
  id: "sync-event-a1",
  sourceEventUid: "source-uid-a1",
  startTime: DOUBLE_START_TIME,
  summary: "Quarterly review",
};

const editedDoubleEvent: MaterializedSyncableEvent = {
  ...mappedDoubleEvent,
  summary: "Quarterly review — moved to Thursday",
};

const doubleMapping: EventMapping = {
  calendarId: DOUBLE_CALENDAR_ID,
  deleteIdentifier: DOUBLE_MAPPED_ID,
  destinationEventUid: DOUBLE_MIRROR_UID,
  endTime: DOUBLE_END_TIME,
  eventStateId: mappedDoubleEvent.id,
  id: DOUBLE_MAPPING_ID,
  sourceCalendarId: "source-cal-a",
  startTime: DOUBLE_START_TIME,
  syncEventHash: createSyncEventContentHash(mappedDoubleEvent),
  syncEventId: mappedDoubleEvent.id,
};

interface DoubleWriteLog {
  deleted: string[];
  pushed: string[];
  updated: string[];
}

const createRelocatingDestination = (): {
  log: DoubleWriteLog;
  provider: CalendarSyncProvider;
} => {
  const log: DoubleWriteLog = { deleted: [], pushed: [], updated: [] };

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds: string[]) => {
      log.deleted.push(...eventIds);
      return Promise.resolve(eventIds.map((): DeleteResult => ({ removedObject: true, success: true })));
    },
    listRemoteEvents: () => Promise.resolve([]),
    pushEvents: (events) => {
      log.pushed.push(...events.map((event) => event.id));
      return Promise.resolve(events.map((): PushResult => ({
        deleteId: "created-1",
        remoteId: "created-1",
        success: true,
      })));
    },
    updateEvents: (updates: EventUpdate[]) => {
      log.updated.push(...updates.map((update) => update.deleteId));
      return Promise.resolve(updates.map((): PushResult => ({
        destinationAnswer: "answered",
        error: "Graph refused the update: 404 ErrorItemNotFound",
        errorType: "HttpError",
        statusCode: 404,
        success: false,
      })));
    },
    verifyEventsExist: (targets: EventVerificationTarget[]) =>
      Promise.resolve(targets.map(({ deleteId }): EventPresence => ({
        event: {
          deleteId: DOUBLE_RELOCATED_ID,
          endTime: DOUBLE_END_TIME,
          isKeeperEvent: true,
          startTime: DOUBLE_START_TIME,
          uid: DOUBLE_MIRROR_UID,
        },
        identifier: deleteId,
        status: "present",
      }))),
  };

  return { log, provider };
};

interface FallbackReport {
  updateFallbacks?: number;
  verificationUnsettled?: number;
}

const readFallbackCount = (outcome: object): number | undefined =>
  (outcome as FallbackReport).updateFallbacks;

const readUnsettled = (outcome: object): number | undefined =>
  (outcome as FallbackReport).verificationUnsettled;

const planRelocatedReplacement = (mappings: EventMapping[]) => {
  const { operations } = computeSyncOperations([editedDoubleEvent], mappings, [], DOUBLE_SCOPE);
  expect(operations).toHaveLength(1);
  expect(operations[0]).toMatchObject({
    deleteId: DOUBLE_MAPPED_ID,
    remoteMissing: true,
    type: "replace",
  });
  return operations;
};

describe("a relocated mirror whose update fails is never a clean run", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not report the failed relocated update as an all-zero no-op", async () => {
    const destination = createRelocatingDestination();

    const outcome = await executeRemoteOperations(
      planRelocatedReplacement([doubleMapping]),
      [doubleMapping],
      DOUBLE_CALENDAR_ID,
      destination.provider,
    );

    expect(destination.log.updated).toEqual([DOUBLE_RELOCATED_ID]);

    const silent = outcome.errors.length === 0
      && outcome.result.addFailed === 0
      && readUnsettled(outcome) === 0
      && readFallbackCount(outcome) === 0;
    expect(silent).toBe(false);
  });

  it("names the mapping whose relocated update failed", async () => {
    const destination = createRelocatingDestination();

    const outcome = await executeRemoteOperations(
      planRelocatedReplacement([doubleMapping]),
      [doubleMapping],
      DOUBLE_CALENDAR_ID,
      destination.provider,
    );

    expect(outcome.errors.filter((entry) => entry.error.includes(DOUBLE_MAPPING_ID)))
      .not.toEqual([]);
  });

  it("does not install the 404-ing identifier on the mapping as a settled repair", async () => {
    const destination = createRelocatingDestination();
    const checkpointed: PendingChanges[] = [];

    const outcome = await executeRemoteOperations(
      planRelocatedReplacement([doubleMapping]),
      [doubleMapping],
      DOUBLE_CALENDAR_ID,
      destination.provider,
      globalThis.undefined,
      globalThis.undefined,
      (changes: PendingChanges) => {
        checkpointed.push(changes);
        return Promise.resolve(true);
      },
    );

    const written: PendingUpdate[] = [
      ...(outcome.changes.updates ?? []),
      ...checkpointed.flatMap((changes) => changes.updates ?? []),
    ];
    expect(written.filter((update) => update.deleteIdentifier === DOUBLE_RELOCATED_ID)).toEqual([]);

    expect(destination.log.pushed).toEqual([]);
    expect(destination.log.deleted).toEqual([]);
  });
});

const DESTINATION_CALENDAR_ID = "cal-1";
const DESTINATION_FOLDER_ID = "external-cal-1";
const DEFAULT_FOLDER_ID = "the-mailbox-default-calendar";

const START_TIME = new Date("2026-09-01T15:00:00.000Z");
const END_TIME = new Date("2026-09-01T16:00:00.000Z");

const MAPPED_ID = "AAMkAGmirror-as-mapped";
const REKEYED_ID = "AAMkAGmirror-after-the-move";
const MIRROR_UID = "mirror-uid-1";
const MAPPING_ID = "mapping-1";

const MAPPED_SUBJECT = "Quarterly review";
const EDITED_SUBJECT = "Quarterly review — moved to Thursday";

interface MailboxEvent {
  categories: string[];
  end: { dateTime: string; timeZone: string };
  folderId: string;
  iCalUId: string;
  id: string;
  isAllDay: boolean;
  showAs: string;
  start: { dateTime: string; timeZone: string };
  subject: string;
}

const makeMailboxEvent = (id: string, iCalUId: string, folderId: string): MailboxEvent => ({
  categories: [KEEPER_CATEGORY],
  end: { dateTime: "2026-09-01T16:00:00.0000000", timeZone: "UTC" },
  folderId,
  iCalUId,
  id,
  isAllDay: false,
  showAs: "busy",
  start: { dateTime: "2026-09-01T15:00:00.0000000", timeZone: "UTC" },
  subject: MAPPED_SUBJECT,
});

interface GraphRequest {
  body: string | null;
  method: string;
  url: string;
}

const readPathSegments = (url: URL): string[] =>
  url.pathname.split("/").filter((segment) => segment.length > 0);

const readDirectEventId = (url: URL): string | null => {
  const segments = readPathSegments(url);
  const eventsIndex = segments.lastIndexOf("events");
  if (eventsIndex === -1) {
    return null;
  }
  const identifier = segments[eventsIndex + 1];
  if (!identifier) {
    return null;
  }
  return decodeURIComponent(identifier);
};

const readAddressedFolderId = (url: URL): string => {
  const segments = readPathSegments(url);
  const calendarsIndex = segments.lastIndexOf("calendars");
  if (calendarsIndex === -1) {
    return DEFAULT_FOLDER_ID;
  }
  const folderId = segments[calendarsIndex + 1];
  if (!folderId) {
    return DEFAULT_FOLDER_ID;
  }
  return decodeURIComponent(folderId);
};

const isCalendarListRead = (url: URL): boolean => {
  const segments = readPathSegments(url);
  return segments.at(-1) === "calendars";
};

const readFilteredUid = (url: URL): string | null => {
  const filter = decodeURIComponent(url.searchParams.get("$filter") ?? "");
  const matched = /iCalUId eq '(?<uid>[^']*)'/u.exec(filter);
  const uid = matched?.groups?.["uid"];
  if (!uid) {
    return null;
  }
  return uid;
};

const readRequestBody = (init?: RequestInit): string | null => {
  if (typeof init?.body !== "string") {
    return null;
  }
  return init.body;
};

const readPatchedSubject = (body: string | null): string | null => {
  if (!body) {
    return null;
  }
  const parsed = JSON.parse(body) as { subject?: unknown };
  if (typeof parsed.subject !== "string") {
    return null;
  }
  return parsed.subject;
};

const installGraphMailbox = (events: MailboxEvent[]): GraphRequest[] => {
  const requests: GraphRequest[] = [];
  const held = [...events];

  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";
    const body = readRequestBody(init);
    requests.push({ body, method, url: url.toString() });

    const directId = readDirectEventId(url);

    if (method === "DELETE") {
      const index = held.findIndex((event) => event.id === directId);
      if (index === -1) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      held.splice(index, 1);
      return Promise.resolve(new Response(null, { status: 204 }));
    }

    if (method === "PATCH") {
      const target = held.find((event) => event.id === directId);
      if (!target) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      return Promise.resolve(Response.json({
        error: {
          code: "ErrorInvalidPropertyRequest",
          message: "The property 'singleValueExtendedProperties' is invalid for this item type.",
        },
      }, { status: 400 }));
    }

    if (method === "POST") {
      const created = makeMailboxEvent(
        "AAMkAGcreated",
        "created-uid",
        readAddressedFolderId(url),
      );
      held.push(created);
      return Promise.resolve(Response.json(created));
    }

    if (isCalendarListRead(url)) {
      return Promise.resolve(Response.json({
        value: [{ id: DESTINATION_FOLDER_ID }, { id: DEFAULT_FOLDER_ID }],
      }));
    }

    if (directId) {
      const found = held.find((event) => event.id === directId);
      if (!found) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      return Promise.resolve(Response.json(found));
    }

    const folderId = readAddressedFolderId(url);
    const uid = readFilteredUid(url);
    const matched = held.filter((event) => event.folderId === folderId && event.iCalUId === uid);
    return Promise.resolve(Response.json({ value: matched }));
  }));

  return requests;
};

const createProvider = () =>
  createOutlookSyncProvider({
    accessToken: "test-token",
    refreshToken: "test-refresh",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    externalCalendarId: DESTINATION_FOLDER_ID,
    calendarId: DESTINATION_CALENDAR_ID,
    userId: "user-1",
  });

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
  deleteIdentifier: MAPPED_ID,
  destinationEventUid: MIRROR_UID,
  endTime: END_TIME,
  eventStateId: "sync-event-1",
  id: MAPPING_ID,
  sourceCalendarId: "source-cal-1",
  startTime: START_TIME,
  syncEventHash: createSyncEventContentHash(mappedEvent),
  syncEventId: "sync-event-1",
};

const WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

const TARGETED_READ_SCOPE = {
  authoritativeMappingIds: new Set([MAPPING_ID]),
  authoritativeWindow: WINDOW,
  requestedWindow: WINDOW,
};

const requestsOfMethod = (requests: GraphRequest[], method: string): GraphRequest[] =>
  requests.filter((request) => request.method === method);

const readRepairsFor = (updates: PendingUpdate[]): PendingUpdate[] =>
  updates.filter((update) => update.id === MAPPING_ID && update.deleteIdentifier === REKEYED_ID);

const namesTheStuckMapping = (errors: { error: string }[]): boolean =>
  errors.some((entry) => entry.error.includes(MAPPING_ID));

interface CycleOutcome {
  addFailed: number;
  checkpointedUpdates: PendingUpdate[];
  countersRaised: boolean;
  errors: { error: string }[];
  patches: GraphRequest[];
  removeFailed: number;
  repairs: PendingUpdate[];
  requests: GraphRequest[];
  unsettled: number;
  updates: PendingUpdate[];
}

const describeDisposition = (cycle: CycleOutcome): string => {
  const repairedInPlace = cycle.repairs.length > 0
    && cycle.patches.some((patch) =>
      patch.url.includes(REKEYED_ID) && readPatchedSubject(patch.body) === EDITED_SUBJECT
    );
  if (repairedInPlace) {
    return "repaired the mapping and delivered the edit";
  }
  if (namesTheStuckMapping(cycle.errors) && cycle.countersRaised) {
    return "reported the unresolved mapping";
  }
  return "silently idle: nothing written, nothing said";
};

const runCycle = async (
  mappings: EventMapping[],
  requests: GraphRequest[],
): Promise<CycleOutcome> => {
  const before = requests.length;
  const checkpointed: PendingChanges[] = [];
  const { operations } = computeSyncOperations(
    [localEvent],
    mappings,
    [],
    TARGETED_READ_SCOPE,
  );

  const outcome = await executeRemoteOperations(
    operations,
    mappings,
    DESTINATION_CALENDAR_ID,
    createProvider(),
    globalThis.undefined,
    globalThis.undefined,
    (changes: PendingChanges) => {
      checkpointed.push(changes);
      return Promise.resolve(true);
    },
  );

  const madeRequests = requests.slice(before);
  const checkpointedUpdates = checkpointed.flatMap((changes) => changes.updates ?? []);
  const updates = outcome.changes.updates ?? [];
  return {
    addFailed: outcome.result.addFailed,
    checkpointedUpdates,
    countersRaised: outcome.verificationUnsettled > 0
      || outcome.result.addFailed > 0
      || outcome.result.removeFailed > 0,
    errors: outcome.errors,
    patches: requestsOfMethod(madeRequests, "PATCH"),
    removeFailed: outcome.result.removeFailed,
    repairs: readRepairsFor([...updates, ...checkpointedUpdates]),
    requests: madeRequests,
    unsettled: outcome.verificationUnsettled,
    updates,
  };
};

const applyRepairs = (existing: EventMapping, updates: PendingUpdate[]): EventMapping => {
  const repair = updates.find((update) => update.id === existing.id);
  if (!repair) {
    return existing;
  }
  return {
    ...existing,
    ...(typeof repair.consecutiveUpdateFailures === "number" && {
      consecutiveUpdateFailures: repair.consecutiveUpdateFailures,
    }),
    deleteIdentifier: repair.deleteIdentifier ?? existing.deleteIdentifier,
    destinationEventUid: repair.destinationEventUid ?? existing.destinationEventUid,
    syncEventHash: repair.syncEventHash ?? existing.syncEventHash,
  };
};

const isSilentCycle = (cycle: CycleOutcome): boolean =>
  cycle.errors.length === 0
  && cycle.addFailed === 0
  && cycle.removeFailed === 0
  && cycle.unsettled === 0;

const readCarriedCounter = (carried: EventMapping): number =>
  carried.consecutiveUpdateFailures ?? 0;

const reachedTheRefusalEscape = (errors: { error: string }[]): boolean =>
  errors.some((entry) => entry.error.includes("keeps refusing the update"));

interface RefusedRun {
  cycles: CycleOutcome[];
  counters: number[];
  requests: GraphRequest[];
}

const SEVEN_CYCLES = 7;

const runRefusedCycles = async (count: number): Promise<RefusedRun> => {
  const requests = installGraphMailbox([
    makeMailboxEvent(REKEYED_ID, MIRROR_UID, DESTINATION_FOLDER_ID),
  ]);
  const cycles: CycleOutcome[] = [];
  const counters: number[] = [];
  let carried = mapping;

  for (let cycle = 0; cycle < count; cycle++) {
    const outcome = await runCycle([carried], requests);
    cycles.push(outcome);
    carried = applyRepairs(carried, [...outcome.updates, ...outcome.checkpointedUpdates]);
    counters.push(readCarriedCounter(carried));
  }

  return { cycles, counters, requests };
};

describe("a relocated mirror the destination durably refuses is never silently reset", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never produces a cycle that looks like a healthy no-op", async () => {
    const run = await runRefusedCycles(SEVEN_CYCLES);

    const silentCycles = run.cycles
      .map((cycle, index) => ({ cycle, index }))
      .filter((entry) => isSilentCycle(entry.cycle))
      .map((entry) => entry.index);

    expect(silentCycles).toEqual([]);
    expect(run.cycles.map((cycle) => describeDisposition(cycle)))
      .not.toContain("silently idle: nothing written, nothing said");
  });

  it("does not reset the accumulated evidence to zero cycle after cycle", async () => {
    const run = await runRefusedCycles(SEVEN_CYCLES);

    expect(run.counters).not.toEqual([1, 2, 0, 1, 2, 0, 1]);
    expect(run.counters.filter((counter) => counter === 0)).toEqual([]);
  });

  it("reaches the refusal escape instead of stalling on the same refused PATCH forever", async () => {
    const run = await runRefusedCycles(SEVEN_CYCLES);

    expect(reachedTheRefusalEscape(run.cycles.flatMap((cycle) => cycle.errors))).toBe(true);
    expect(requestsOfMethod(run.requests, "DELETE")).toEqual([]);
    expect(requestsOfMethod(run.requests, "POST")).toEqual([]);
  });
});
