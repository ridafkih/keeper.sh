import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { generateDeterministicEventUid } from "../../../src/core/events/identity";
import { createCalDAVSyncProvider } from "../../../src/providers/caldav/destination/provider";
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

/* Every status in PAYLOAD_REFUSAL_STATUS_CODES. A real server refuses the create PUT for the
   same reason it refused the update PUT: both send eventToICalString(event, uid) to the same
   ${uid}.ics href, so a delete-then-add only destroys the object and leaves nothing behind. */
const PAYLOAD_REFUSALS = [
  { status: 400, statusText: "Bad Request" },
  { status: 413, statusText: "Content Too Large" },
  { status: 415, statusText: "Unsupported Media Type" },
  { status: 422, statusText: "Unprocessable Entity" },
  { status: 431, statusText: "Request Header Fields Too Large" },
];

const movedMeeting: MaterializedSyncableEvent = {
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-03-15T10:00:00.000Z"),
  id: "event-state-id-1",
  sourceEventUid: "source-event-uid-1",
  startTime: new Date("2026-03-15T09:00:00.000Z"),
  summary: "Weekly standup, moved",
};

const uid = generateDeterministicEventUid(movedMeeting.id);
const ownedObjectPath = `/calendars/user/shared/${uid}.ics`;
/* A server that names objects itself: the stored basename never matches <uid>.ics, so the update
   path can never address it while a create writes the correct fresh href. */
const serverNamedObjectPath = "/calendars/user/shared/2f9c41d8-server-chosen.ics";

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

const runCycles = async (deleteIdentifier: string): Promise<CycleOutcome[]> => {
  const cycleOutcomes: CycleOutcome[] = [];
  let mapping: EventMapping | null = makeMapping(deleteIdentifier);

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
  }

  return cycleOutcomes;
};

beforeEach(() => {
  for (const mock of Object.values(clientMocks)) {
    mock.mockReset();
  }
  clientMocks.resolveCalendarUrl.mockImplementation((url: string) => Promise.resolve(url));
  clientMocks.createCalendarObject.mockImplementation(() => Promise.resolve());
  clientMocks.deleteCalendarObject.mockImplementation(() => Promise.resolve());
  clientMocks.deleteCalendarObjectByUrl.mockImplementation(() => Promise.resolve());
});

describe("a payload refusal never promotes on any destination", () => {
  for (const { status, statusText } of PAYLOAD_REFUSALS) {
    it(`never deletes the live object after a ${status} the create PUT refuses just the same`, async () => {
      clientMocks.updateCalendarObjectByUrl.mockRejectedValue(httpError(status, statusText));
      clientMocks.createCalendarObject.mockRejectedValue(httpError(status, statusText));

      const cycleOutcomes = await runCycles(ownedObjectPath);

      expect(clientMocks.updateCalendarObjectByUrl).toHaveBeenCalledTimes(CYCLES);
      expect(clientMocks.deleteCalendarObjectByUrl).not.toHaveBeenCalled();
      expect(clientMocks.deleteCalendarObject).not.toHaveBeenCalled();
      expect(clientMocks.createCalendarObject).not.toHaveBeenCalled();
      expect(cycleOutcomes.flatMap((cycle) => cycle.deletedMappingIds)).toEqual([]);
      expect(cycleOutcomes.flatMap((cycle) => cycle.insertedUids)).toEqual([]);
    });
  }

  it("still promotes a stored href the update path can never address", async () => {
    const cycleOutcomes = await runCycles(serverNamedObjectPath);

    expect(cycleOutcomes[0]).toEqual({ deletedMappingIds: [], insertedUids: [] });
    expect(clientMocks.createCalendarObject).toHaveBeenCalledTimes(1);
    expect(cycleOutcomes.flatMap((cycle) => cycle.deletedMappingIds)).toEqual(["map-1"]);
    expect(cycleOutcomes.flatMap((cycle) => cycle.insertedUids)).toEqual([uid]);
  });
});
