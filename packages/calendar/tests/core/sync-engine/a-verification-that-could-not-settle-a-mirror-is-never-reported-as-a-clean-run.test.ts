import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { createOutlookSyncProvider } from "../../../src/providers/outlook/destination/provider";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";
import type {
  DeleteResult,
  EventPresence,
  EventVerificationTarget,
  MaterializedSyncableEvent,
  PushResult,
} from "../../../src/core/types";
import type { CalendarSyncProvider, EventUpdate } from "../../../src/core/sync-engine/types";
import type { EventMapping } from "../../../src/core/events/mappings";

const DESTINATION_CALENDAR_ID = "dest-cal-1";
const START_TIME = new Date("2026-05-11T09:00:00.000Z");
const END_TIME = new Date("2026-05-11T10:00:00.000Z");

const TEST_RECONCILIATION_SCOPE = {
  authoritativeWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
  requestedWindow: {
    timeMax: new Date("2100-01-01T00:00:00.000Z"),
    timeMin: new Date("2000-01-01T00:00:00.000Z"),
  },
};

const makeEvent = (id: string, summary: string): MaterializedSyncableEvent => ({
  calendarId: "source-cal-1",
  calendarName: "Work",
  calendarUrl: null,
  endTime: END_TIME,
  id,
  sourceEventUid: `source-uid-${id}`,
  startTime: START_TIME,
  summary,
});

const makeMapping = (
  mappingId: string,
  event: MaterializedSyncableEvent,
  deleteIdentifier: string,
  destinationEventUid: string,
): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier,
  destinationEventUid,
  endTime: END_TIME,
  eventStateId: event.id,
  id: mappingId,
  sourceCalendarId: "source-cal-1",
  startTime: START_TIME,
  syncEventHash: createSyncEventContentHash(event),
  syncEventId: event.id,
});

const planMissingMirrorReplacements = (
  events: MaterializedSyncableEvent[],
  mappings: EventMapping[],
) => {
  const { operations } = computeSyncOperations(events, mappings, [], TEST_RECONCILIATION_SCOPE);
  expect(operations).toHaveLength(events.length);
  for (const operation of operations) {
    expect(operation.type).toBe("replace");
    expect(operation.type === "replace" && operation.remoteMissing).toBe(true);
  }
  return operations;
};

interface WriteLog {
  deleted: string[];
  pushed: string[];
  updated: string[];
}

const createWatchedDestination = (
  verifyEventsExist: NonNullable<CalendarSyncProvider["verifyEventsExist"]>,
): { log: WriteLog; provider: CalendarSyncProvider } => {
  const log: WriteLog = { deleted: [], pushed: [], updated: [] };
  let created = 0;

  const provider: CalendarSyncProvider = {
    deleteEvents: (eventIds) => {
      log.deleted.push(...eventIds);
      return Promise.resolve(eventIds.map((): DeleteResult => ({ removedObject: true, success: true })));
    },
    listRemoteEvents: () => Promise.resolve([]),
    pushEvents: (events) => {
      log.pushed.push(...events.map((event) => event.id));
      return Promise.resolve(events.map((): PushResult => {
        created += 1;
        return { deleteId: `created-${created}`, remoteId: `created-${created}`, success: true };
      }));
    },
    updateEvents: (updates: EventUpdate[]) => {
      log.updated.push(...updates.map((update) => update.deleteId));
      return Promise.resolve(updates.map((update): PushResult => ({
        deleteId: update.deleteId,
        remoteId: update.deleteId,
        success: true,
      })));
    },
    verifyEventsExist,
  };

  return { log, provider };
};

interface UnsettledReport {
  verificationUnsettled?: number;
}

const readUnsettledCount = (outcome: object): number | undefined =>
  (outcome as UnsettledReport).verificationUnsettled;

const errorsNaming = (errors: { error: string }[], mappingId: string): { error: string }[] =>
  errors.filter((entry) => entry.error.includes(mappingId));

describe("a verification that could not settle a mirror is never reported as a clean run", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restores the mirror when the read positively reports it absent", async () => {
    const event = makeEvent("ev-1", "Team lunch");
    const mapping = makeMapping("map-1", event, "AAMkAGmirror-1", "mirror-uid-1");
    const destination = createWatchedDestination((targets: EventVerificationTarget[]) =>
      Promise.resolve(targets.map(({ deleteId }): EventPresence => ({ identifier: deleteId, status: "absent" }))));

    const outcome = await executeRemoteOperations(
      planMissingMirrorReplacements([event], [mapping]),
      [mapping],
      DESTINATION_CALENDAR_ID,
      destination.provider,
    );

    expect(destination.log.pushed).toEqual(["ev-1"]);
    expect(outcome.result.added).toBe(1);
    expect(readUnsettledCount(outcome)).toBe(0);
  });

  it("counts and names the mapping when the verification read throws", async () => {
    const event = makeEvent("ev-1", "Team lunch");
    const mapping = makeMapping("map-1", event, "AAMkAGmirror-1", "mirror-uid-1");
    const destination = createWatchedDestination(() =>
      Promise.reject(new Error("Graph read failed: 503 Service Unavailable")));

    const outcome = await executeRemoteOperations(
      planMissingMirrorReplacements([event], [mapping]),
      [mapping],
      DESTINATION_CALENDAR_ID,
      destination.provider,
    );

    expect(destination.log).toEqual({ deleted: [], pushed: [], updated: [] });
    expect(readUnsettledCount(outcome)).toBe(1);
    expect(errorsNaming(outcome.errors, "map-1")).not.toEqual([]);
  });

  it("counts and names the mapping when the read reports the target unknown", async () => {
    const event = makeEvent("ev-1", "Team lunch");
    const mapping = makeMapping("map-1", event, "AAMkAGmirror-1", "mirror-uid-1");
    const destination = createWatchedDestination((targets: EventVerificationTarget[]) =>
      Promise.resolve(targets.map(({ deleteId }): EventPresence => ({ identifier: deleteId, status: "unknown" }))));

    const outcome = await executeRemoteOperations(
      planMissingMirrorReplacements([event], [mapping]),
      [mapping],
      DESTINATION_CALENDAR_ID,
      destination.provider,
    );

    expect(destination.log).toEqual({ deleted: [], pushed: [], updated: [] });
    expect(readUnsettledCount(outcome)).toBe(1);
    expect(errorsNaming(outcome.errors, "map-1")).not.toEqual([]);
  });

  it("counts the mapping the report never mentioned", async () => {
    const first = makeEvent("ev-1", "Team lunch");
    const second = makeEvent("ev-2", "Design review");
    const mappings = [
      makeMapping("map-1", first, "AAMkAGmirror-1", "mirror-uid-1"),
      makeMapping("map-2", second, "AAMkAGmirror-2", "mirror-uid-2"),
    ];
    const destination = createWatchedDestination((targets: EventVerificationTarget[]) => {
      const [answered] = targets;
      if (!answered) {
        return Promise.resolve([]);
      }
      return Promise.resolve([{ identifier: answered.deleteId, status: "absent" } as EventPresence]);
    });

    const outcome = await executeRemoteOperations(
      planMissingMirrorReplacements([first, second], mappings),
      mappings,
      DESTINATION_CALENDAR_ID,
      destination.provider,
    );

    expect(destination.log.pushed).toEqual(["ev-1"]);
    expect(readUnsettledCount(outcome)).toBe(1);
    expect(errorsNaming(outcome.errors, "map-2")).not.toEqual([]);
  });

  it("propagates a run-level abort out of the verification read and writes nothing after it", async () => {
    const first = makeEvent("ev-1", "Team lunch");
    const second = makeEvent("ev-2", "Design review");
    const mappings = [
      makeMapping("map-1", first, "AAMkAGmirror-1", "mirror-uid-1"),
      makeMapping("map-2", second, "AAMkAGmirror-2", "mirror-uid-2"),
    ];
    const controller = new AbortController();
    const destination = createWatchedDestination(() => {
      controller.abort();
      return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
    });

    const run = executeRemoteOperations(
      planMissingMirrorReplacements([first, second], mappings),
      mappings,
      DESTINATION_CALENDAR_ID,
      destination.provider,
    );

    await expect(run).rejects.toThrow(/aborted/iu);
    expect(controller.signal.aborted).toBe(true);
    expect(destination.log).toEqual({ deleted: [], pushed: [], updated: [] });
  });
});

const DEFAULT_FOLDER_ID = "the-mailbox-default-calendar";
const DESTINATION_FOLDER_ID = "external-cal-1";
const REFUSING_FOLDER_ID = "external-cal-2";

interface GraphRequest {
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

const isCalendarCollectionRead = (url: URL): boolean =>
  readPathSegments(url).at(-1) === "calendars";

const mailboxCalendars = [
  { id: DEFAULT_FOLDER_ID, isDefaultCalendar: true, name: "Calendar" },
  { id: DESTINATION_FOLDER_ID, isDefaultCalendar: false, name: "Keeper" },
  { id: REFUSING_FOLDER_ID, isDefaultCalendar: false, name: "Shared with me" },
];

const installMailboxWithOneRefusingFolder = (): GraphRequest[] => {
  const requests: GraphRequest[] = [];

  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";
    requests.push({ method, url: url.toString() });

    if (method !== "GET") {
      return Promise.resolve(Response.json({
        categories: [KEEPER_CATEGORY],
        end: { dateTime: "2026-05-11T10:00:00.0000000", timeZone: "UTC" },
        iCalUId: "created-uid",
        id: "AAMkAGcreated",
        isAllDay: false,
        showAs: "busy",
        start: { dateTime: "2026-05-11T09:00:00.0000000", timeZone: "UTC" },
        subject: "Created",
      }));
    }

    if (isCalendarCollectionRead(url)) {
      return Promise.resolve(Response.json({ value: mailboxCalendars }));
    }

    if (readDirectEventId(url)) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }

    if (readAddressedFolderId(url) === REFUSING_FOLDER_ID) {
      return Promise.resolve(new Response(null, { status: 403 }));
    }

    return Promise.resolve(Response.json({ value: [] }));
  }));

  return requests;
};

const createRealOutlookProvider = () =>
  createOutlookSyncProvider({
    accessToken: "test-token",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    calendarId: DESTINATION_CALENDAR_ID,
    externalCalendarId: DESTINATION_FOLDER_ID,
    refreshToken: "test-refresh",
    userId: "user-1",
  });

const outlookTargets = Array.from({ length: 5 }, (_unused, index) => ({
  deleteId: `AAMkAGmirror-${index + 1}`,
  uid: `mirror-uid-${index + 1}`,
}));

describe("one unreadable mailbox folder turns off restore for every mirror, and must say so", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports every target unknown when a sibling folder refuses its listing", async () => {
    installMailboxWithOneRefusingFolder();
    const { verifyEventsExist } = createRealOutlookProvider();

    const report = await verifyEventsExist(outlookTargets);

    expect(report).toHaveLength(5);
    expect(report.map((presence) => presence.status)).toEqual(
      outlookTargets.map(() => "unknown"),
    );
  });

  it("surfaces that blanket unknown as unsettled rather than an all-zero clean run", async () => {
    const requests = installMailboxWithOneRefusingFolder();
    const event = makeEvent("ev-1", "Quarterly review");
    const mapping = makeMapping("map-1", event, "AAMkAGmirror-1", "mirror-uid-1");

    const outcome = await executeRemoteOperations(
      planMissingMirrorReplacements([event], [mapping]),
      [mapping],
      DESTINATION_CALENDAR_ID,
      createRealOutlookProvider(),
    );

    expect(requests.filter((request) => request.method === "POST")).toEqual([]);
    expect(outcome.result.added).toBe(0);
    expect(readUnsettledCount(outcome)).toBe(1);
    expect(errorsNaming(outcome.errors, "map-1")).not.toEqual([]);
  });
});
