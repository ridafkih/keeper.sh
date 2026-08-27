import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";
import { generateDeterministicEventUid } from "../../../src/core/events/identity";
import { createCalDAVSyncProvider } from "../../../src/providers/caldav/destination/provider";
import { eventToICalString } from "../../../src/providers/caldav/shared/ics";
import { CalDAVHttpError } from "../../../src/providers/caldav/shared/client";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { MaterializedSyncableEvent, SyncOperation } from "../../../src/core/types";

const clientMocks = vi.hoisted(() => ({
  createCalendarObject: vi.fn(),
  deleteCalendarObject: vi.fn(),
  deleteCalendarObjectByUrl: vi.fn(),
  fetchCalendarObject: vi.fn(),
  fetchCalendarObjects: vi.fn(),
  fetchCalendarObjectsByUrls: vi.fn(),
  resolveCalendarUrl: vi.fn(),
  updateCalendarObjectByUrl: vi.fn(),
  verifyCalendarObjectsByUrls: vi.fn(),
}));

vi.mock("../../../src/providers/caldav/shared/client", () => {
  class MockCalDAVHttpError extends Error {
    status: number;

    constructor(response: Response) {
      super(`CalDAV update failed: ${response.status} ${response.statusText}`.trim());
      this.name = "CalDAVHttpError";
      this.status = response.status;
    }
  }

  class MockCalDAVCreateConflictError extends MockCalDAVHttpError {
    constructor(response: Response) {
      super(response);
      this.name = "CalDAVCreateConflictError";
    }
  }

  class CalDAVClient {
    createCalendarObject = clientMocks.createCalendarObject;
    deleteCalendarObject = clientMocks.deleteCalendarObject;
    deleteCalendarObjectByUrl = clientMocks.deleteCalendarObjectByUrl;
    fetchCalendarObject = clientMocks.fetchCalendarObject;
    fetchCalendarObjects = clientMocks.fetchCalendarObjects;
    fetchCalendarObjectsByUrls = clientMocks.fetchCalendarObjectsByUrls;
    resolveCalendarUrl = clientMocks.resolveCalendarUrl;
    updateCalendarObjectByUrl = clientMocks.updateCalendarObjectByUrl;
    verifyCalendarObjectsByUrls = clientMocks.verifyCalendarObjectsByUrls;
  }

  return {
    CalDAVClient,
    CalDAVCreateConflictError: MockCalDAVCreateConflictError,
    CalDAVHttpError: MockCalDAVHttpError,
  };
});

const CALENDAR_URL = "https://caldav.example.invalid/calendars/user/shared/";
const DESTINATION_CALENDAR_ID = "dest-cal-1";
const CYCLES = 3;

const PAYLOAD_REFUSALS = [
  { status: 400, statusText: "Bad Request" },
  { status: 413, statusText: "Content Too Large" },
  { status: 415, statusText: "Unsupported Media Type" },
  { status: 422, statusText: "Unprocessable Entity" },
  { status: 431, statusText: "Request Header Fields Too Large" },
];

const storedMeeting: MaterializedSyncableEvent = {
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-03-15T10:00:00.000Z"),
  id: "event-state-id-1",
  sourceEventUid: "source-event-uid-1",
  startTime: new Date("2026-03-15T09:00:00.000Z"),
  summary: "Standup as first written",
};

const movedMeeting: MaterializedSyncableEvent = {
  ...storedMeeting,
  summary: "Standup pushed to Thursday",
};

const uid = generateDeterministicEventUid(movedMeeting.id);
const ownedObjectPath = `/calendars/user/shared/${uid}.ics`;
const serverNamedObjectPath = "/calendars/user/shared/2f9c41d8-server-chosen.ics";
const serverNamedObjectUrl = new URL(serverNamedObjectPath, CALENDAR_URL).href;

const makeMapping = (deleteIdentifier: string): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier,
  destinationEventUid: uid,
  endTime: movedMeeting.endTime,
  eventStateId: movedMeeting.id,
  id: "map-1",
  sourceCalendarId: "source-calendar-id",
  startTime: movedMeeting.startTime,
  syncEventHash: "stale-hash",
  syncEventId: movedMeeting.id,
});

const makeReplacement = (mapping: EventMapping): Extract<SyncOperation, { type: "replace" }> => ({
  deleteId: mapping.deleteIdentifier,
  event: movedMeeting,
  staleMappingId: mapping.id,
  type: "replace",
  uid: mapping.destinationEventUid,
});

const httpError = (status: number, statusText: string): Error =>
  new CalDAVHttpError(new Response(null, { status, statusText }), "update");

const notFound = (): Error => httpError(404, "Not Found");

const uidConflict = (heldAt: string): Error =>
  new CalDAVHttpError(
    new Response(
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<d:error xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">',
        `<c:no-uid-conflict><d:href>${heldAt}</d:href></c:no-uid-conflict>`,
        "</d:error>",
      ].join(""),
      { status: 409, statusText: "Conflict" },
    ),
    "create",
  );

const remoteObjects = new Map<string, string>();

const uidOf = (iCalString: string): string =>
  /^UID:(?<uid>.*)$/mu.exec(iCalString)?.groups?.["uid"]?.trim() ?? "";

const holderOfUid = (iCalString: string, exceptUrl: string): string | null => {
  const held = [...remoteObjects].find(
    ([objectUrl, data]) => objectUrl !== exceptUrl && uidOf(data) === uidOf(iCalString),
  );
  if (!held) {
    return null;
  }
  return held[0];
};

const createProvider = () =>
  createCalDAVSyncProvider({
    authMethod: "basic",
    calendarUrl: CALENDAR_URL,
    password: "password",
    serverUrl: "https://caldav.example.invalid/",
    username: "user",
  });

interface CycleOutcome {
  deletedMappingIds: string[];
  insertedUids: string[];
}

interface CycleRun {
  carriedMapping: EventMapping | null;
  cycleOutcomes: CycleOutcome[];
}

const carryMappingForward = (
  mapping: EventMapping,
  outcome: Awaited<ReturnType<typeof executeRemoteOperations>>,
): EventMapping | null => {
  if (outcome.changes.deletes.includes(mapping.id)) {
    return null;
  }
  const pendingUpdate = (outcome.changes.updates ?? []).find((update) => update.id === mapping.id);
  if (!pendingUpdate) {
    return mapping;
  }
  return { ...mapping, ...pendingUpdate, id: mapping.id } as EventMapping;
};

const runCycles = async (deleteIdentifier: string): Promise<CycleRun> => {
  const cycleOutcomes: CycleOutcome[] = [];
  let mapping: EventMapping | null = makeMapping(deleteIdentifier);
  let carriedMapping: EventMapping | null = mapping;

  remoteObjects.clear();
  remoteObjects.set(
    new URL(deleteIdentifier, CALENDAR_URL).href,
    eventToICalString(storedMeeting, uid),
  );

  for (let cycle = 0; cycle < CYCLES; cycle++) {
    if (!mapping) {
      cycleOutcomes.push({ deletedMappingIds: [], insertedUids: [] });
      continue;
    }

    const outcome = await executeRemoteOperations(
      [makeReplacement(mapping)],
      [mapping],
      DESTINATION_CALENDAR_ID,
      createProvider(),
    );

    cycleOutcomes.push({
      deletedMappingIds: outcome.changes.deletes,
      insertedUids: outcome.changes.inserts.map((insert) => insert.destinationEventUid),
    });
    mapping = carryMappingForward(mapping, outcome);
    carriedMapping = mapping;
  }

  return { carriedMapping, cycleOutcomes };
};

beforeEach(() => {
  for (const mock of Object.values(clientMocks)) {
    mock.mockReset();
  }
  remoteObjects.clear();
  clientMocks.resolveCalendarUrl.mockImplementation((url: string) => Promise.resolve(url));
  clientMocks.verifyCalendarObjectsByUrls.mockImplementation(
    ({ objectUrls }: { objectUrls: string[] }) => Promise.resolve(objectUrls.map((url) => {
      const data = remoteObjects.get(url);
      if (!data) {
        return { data: null, path: new URL(url).pathname, presence: "absent" as const };
      }
      return { data, path: new URL(url).pathname, presence: "present" as const };
    })),
  );
  clientMocks.createCalendarObject.mockImplementation(
    ({ calendarUrl, filename, iCalString }: {
      calendarUrl: string;
      filename: string;
      iCalString: string;
    }) => {
      const objectUrl = new URL(filename, calendarUrl).href;
      const heldAt = holderOfUid(iCalString, objectUrl);
      if (heldAt) {
        return Promise.reject(uidConflict(heldAt));
      }
      remoteObjects.set(objectUrl, iCalString);
      return Promise.resolve();
    },
  );
  clientMocks.deleteCalendarObject.mockImplementation(
    ({ calendarUrl, filename }: { calendarUrl: string; filename: string }) => {
      if (!remoteObjects.delete(new URL(filename, calendarUrl).href)) {
        return Promise.reject(notFound());
      }
      return Promise.resolve();
    },
  );
  clientMocks.deleteCalendarObjectByUrl.mockImplementation(({ objectUrl }: { objectUrl: string }) => {
    if (!remoteObjects.delete(objectUrl)) {
      return Promise.reject(notFound());
    }
    return Promise.resolve();
  });
  clientMocks.updateCalendarObjectByUrl.mockImplementation(
    ({ iCalString, objectUrl }: { iCalString: string; objectUrl: string }) => {
      if (!remoteObjects.has(objectUrl)) {
        return Promise.reject(notFound());
      }
      remoteObjects.set(objectUrl, iCalString);
      return Promise.resolve();
    },
  );
});

describe("a payload refusal never promotes on any destination", () => {
  for (const { status, statusText } of PAYLOAD_REFUSALS) {
    it(`never deletes the live object after a ${status} the create PUT refuses just the same`, async () => {
      clientMocks.updateCalendarObjectByUrl.mockRejectedValue(httpError(status, statusText));
      clientMocks.createCalendarObject.mockRejectedValue(httpError(status, statusText));

      const { cycleOutcomes } = await runCycles(ownedObjectPath);

      expect(clientMocks.updateCalendarObjectByUrl).toHaveBeenCalledTimes(CYCLES);
      expect(clientMocks.deleteCalendarObjectByUrl).not.toHaveBeenCalled();
      expect(clientMocks.deleteCalendarObject).not.toHaveBeenCalled();
      expect(clientMocks.createCalendarObject).not.toHaveBeenCalled();
      expect(cycleOutcomes.flatMap((cycle) => cycle.deletedMappingIds)).toEqual([]);
      expect(cycleOutcomes.flatMap((cycle) => cycle.insertedUids)).toEqual([]);
    });
  }

  it("rewrites a stored href the update path cannot name, in place, on the answered cycle", async () => {
    const { carriedMapping, cycleOutcomes } = await runCycles(serverNamedObjectPath);

    expect(clientMocks.updateCalendarObjectByUrl).toHaveBeenCalledTimes(CYCLES);
    for (const call of clientMocks.updateCalendarObjectByUrl.mock.calls) {
      expect(call[0]?.objectUrl).toBe(serverNamedObjectUrl);
    }

    const stored = remoteObjects.get(serverNamedObjectUrl);
    expect(stored).toContain(movedMeeting.summary);
    expect(stored).not.toContain(storedMeeting.summary);
    expect(uidOf(stored ?? "")).toBe(uid);
    expect([...remoteObjects.keys()]).toEqual([serverNamedObjectUrl]);

    expect(clientMocks.createCalendarObject).not.toHaveBeenCalled();
    expect(clientMocks.deleteCalendarObjectByUrl).not.toHaveBeenCalled();
    expect(clientMocks.deleteCalendarObject).not.toHaveBeenCalled();
    expect(cycleOutcomes.flatMap((cycle) => cycle.deletedMappingIds)).toEqual([]);
    expect(cycleOutcomes.flatMap((cycle) => cycle.insertedUids)).toEqual([]);

    expect(carriedMapping?.deleteIdentifier).toBe(serverNamedObjectPath);
    expect(carriedMapping?.syncEventHash).toBe(createSyncEventContentHash(movedMeeting));
  });
});
