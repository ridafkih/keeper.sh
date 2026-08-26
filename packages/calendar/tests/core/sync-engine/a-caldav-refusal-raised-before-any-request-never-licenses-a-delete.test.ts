import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { generateDeterministicEventUid } from "../../../src/core/events/identity";
import { createCalDAVSyncProvider } from "../../../src/providers/caldav/destination/provider";
import { eventToICalString } from "../../../src/providers/caldav/shared/ics";
import { CalDAVHttpError } from "../../../src/providers/caldav/shared/client";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { MaterializedSyncableEvent, SyncOperation } from "../../../src/core/types";

/* At least as capable as the real client: the provider's update verb writes through
   updateCalendarObjectByUrl and its escapes read through verifyCalendarObjectsByUrls, so a double
   missing either of them certifies whatever the missing verb would have done. */
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
    operation: string;

    status: number;

    constructor(response: Response, operation: string) {
      super(`CalDAV ${operation} failed: ${response.status} ${response.statusText}`.trim());
      this.name = "CalDAVHttpError";
      this.operation = operation;
      this.status = response.status;
    }
  }

  class MockCalDAVCreateConflictError extends MockCalDAVHttpError {
    constructor(response: Response, operation: string) {
      super(response, operation);
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

const SERVER_URL = "https://caldav.example.com/";
const CALENDAR_URL = "https://caldav.example.com/calendars/user/shared/";
const DESTINATION_CALENDAR_ID = "dest-cal-reassign";
const MAPPING_ID = "map-reassign-1";
const CYCLES = 4;

/* Occurrence reassignment: pairReidentifiedMaterializedOccurrences pairs a NEW local event with an
   OLD mapping, so the replace it produces carries an event whose id is not the mapping's
   syncEventId by construction. */
const OLD_EVENT_ID = "occurrence-state-id-old";
const NEW_EVENT_ID = "occurrence-state-id-new";

const oldUid = generateDeterministicEventUid(OLD_EVENT_ID);
const newUid = generateDeterministicEventUid(NEW_EVENT_ID);

/* The href the server chose for the object, which is the one the mapping records. It can never
   equal `${generateDeterministicEventUid(newEvent.id)}.ics`. */
const serverHref = `/calendars/user/shared/${oldUid}.ics`;
const serverObjectUrl = `https://caldav.example.com${serverHref}`;

const reassignedEvent: MaterializedSyncableEvent = {
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-07-08T10:00:00.000Z"),
  id: NEW_EVENT_ID,
  sourceEventUid: "source-event-uid-reassigned",
  startTime: new Date("2026-07-08T09:00:00.000Z"),
  summary: "Team sync, reassigned occurrence",
};

const previousEvent: MaterializedSyncableEvent = {
  ...reassignedEvent,
  id: OLD_EVENT_ID,
  sourceEventUid: "source-event-uid-previous",
  summary: "Team sync",
};

const baseMapping = (): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  consecutiveUpdateFailures: 2,
  deleteIdentifier: serverHref,
  destinationEventUid: oldUid,
  endTime: reassignedEvent.endTime,
  eventStateId: "series-owner-id",
  id: MAPPING_ID,
  sourceCalendarId: "source-calendar-id",
  startTime: reassignedEvent.startTime,
  syncEventHash: "stale-hash",
  syncEventId: OLD_EVENT_ID,
});

const toReassignmentReplace = (
  mapping: EventMapping,
): Extract<SyncOperation, { type: "replace" }> => ({
  deleteId: mapping.deleteIdentifier,
  event: reassignedEvent,
  staleMappingId: mapping.id,
  type: "replace",
  uid: mapping.destinationEventUid,
});

const createProvider = () =>
  createCalDAVSyncProvider({
    authMethod: "basic",
    calendarUrl: CALENDAR_URL,
    password: "password",
    serverUrl: SERVER_URL,
    username: "user",
  });

/* A synthetic stand-in for the customer's collection, so the assertions are about the live object
   surviving rather than about which calls happened to be made. */
const remoteObjects = new Map<string, string>();

/* The serializer stamps DTSTAMP from the wall clock, so the live object is identified by the
   content only it carries rather than by a byte-for-byte re-serialization. */
const liveObjectStillHoldsThePreviousEvent = (): boolean => {
  const stored = remoteObjects.get(serverObjectUrl);
  if (!stored) {
    return false;
  }
  if (stored.includes(reassignedEvent.summary)) {
    return false;
  }
  return stored.includes(previousEvent.summary) && stored.includes(oldUid);
};

const notFound = (operation: "create" | "delete" | "update"): Error =>
  new CalDAVHttpError(new Response(null, { status: 404, statusText: "Not Found" }), operation);

interface CycleOutcome {
  added: number;
  errors: string[];
  removed: number;
}

const runCycles = async (cycleCount: number): Promise<CycleOutcome[]> => {
  const cycles: CycleOutcome[] = [];
  let mapping = baseMapping();

  for (let cycle = 0; cycle < cycleCount; cycle++) {
    const outcome = await executeRemoteOperations(
      [toReassignmentReplace(mapping)],
      [mapping],
      DESTINATION_CALENDAR_ID,
      createProvider(),
    );

    cycles.push({
      added: outcome.result.added,
      errors: outcome.errors.map((entry) => entry.error),
      removed: outcome.result.removed,
    });

    const carried = (outcome.changes.updates ?? []).find((update) => update.id === MAPPING_ID);
    mapping = { ...mapping, ...carried, id: MAPPING_ID };
  }

  return cycles;
};

beforeEach(() => {
  for (const mock of Object.values(clientMocks)) {
    mock.mockReset();
  }
  remoteObjects.clear();
  remoteObjects.set(serverObjectUrl, eventToICalString(previousEvent, oldUid));

  clientMocks.resolveCalendarUrl.mockImplementation((url: string) => Promise.resolve(url));
  clientMocks.updateCalendarObjectByUrl.mockImplementation(
    ({ iCalString, objectUrl }: { iCalString: string; objectUrl: string }) => {
      if (!remoteObjects.has(objectUrl)) {
        return Promise.reject(notFound("update"));
      }
      remoteObjects.set(objectUrl, iCalString);
      return Promise.resolve();
    },
  );
  clientMocks.deleteCalendarObjectByUrl.mockImplementation(
    ({ objectUrl }: { objectUrl: string }) => {
      if (!remoteObjects.delete(objectUrl)) {
        return Promise.reject(notFound("delete"));
      }
      return Promise.resolve();
    },
  );
  clientMocks.deleteCalendarObject.mockImplementation(
    ({ calendarUrl, filename }: { calendarUrl: string; filename: string }) => {
      if (!remoteObjects.delete(`${calendarUrl}${filename}`)) {
        return Promise.reject(notFound("delete"));
      }
      return Promise.resolve();
    },
  );
  clientMocks.createCalendarObject.mockImplementation(
    ({ calendarUrl, filename, iCalString }: {
      calendarUrl: string;
      filename: string;
      iCalString: string;
    }) => {
      remoteObjects.set(`${calendarUrl}${filename}`, iCalString);
      return Promise.resolve();
    },
  );
  clientMocks.fetchCalendarObject.mockImplementation(
    ({ calendarUrl, filename }: { calendarUrl: string; filename: string }) => {
      const data = remoteObjects.get(`${calendarUrl}${filename}`);
      if (!data) {
        return Promise.resolve(null);
      }
      return Promise.resolve({ data, etag: "\"etag-1\"", url: `${calendarUrl}${filename}` });
    },
  );
  clientMocks.fetchCalendarObjectsByUrls.mockImplementation(
    ({ objectUrls }: { objectUrls: string[] }) =>
      Promise.resolve(objectUrls.flatMap((url) => {
        const data = remoteObjects.get(url);
        if (!data) {
          return [];
        }
        return [{ data, url }];
      })),
  );
  /* Only the server's own 404 is absence; anything it holds comes back with its bytes. */
  clientMocks.verifyCalendarObjectsByUrls.mockImplementation(
    ({ objectUrls }: { objectUrls: string[] }) =>
      Promise.resolve(objectUrls.map((url) => {
        const data = remoteObjects.get(url);
        if (!data) {
          return { data: null, path: new URL(url).pathname, presence: "absent" };
        }
        return { data, path: new URL(url).pathname, presence: "present" };
      })),
  );
});

describe("a CalDAV refusal raised before any request never licenses a delete", () => {
  it("issues no delete on the promotion cycle and leaves the live object standing", async () => {
    /* The premise the reassignment builds: the stored href can never name the new event's uid. */
    expect(serverHref).not.toContain(newUid);

    const [cycle] = await runCycles(1);

    expect(clientMocks.updateCalendarObjectByUrl).not.toHaveBeenCalled();
    expect(clientMocks.deleteCalendarObjectByUrl).not.toHaveBeenCalled();
    expect(clientMocks.deleteCalendarObject).not.toHaveBeenCalled();
    expect(liveObjectStillHoldsThePreviousEvent()).toBe(true);
    expect(cycle?.removed).toBe(0);
    expect(cycle?.errors.some((error) => error.includes("does not belong to event"))).toBe(true);
  });

  it("still issues no delete after the refusal repeats for four cycles, and keeps naming it", async () => {
    const cycles = await runCycles(CYCLES);

    expect(clientMocks.deleteCalendarObjectByUrl).not.toHaveBeenCalled();
    expect(clientMocks.deleteCalendarObject).not.toHaveBeenCalled();
    expect(liveObjectStillHoldsThePreviousEvent()).toBe(true);
    for (const cycle of cycles) {
      expect(cycle.removed).toBe(0);
      expect(cycle.errors.some((error) => error.includes("does not belong to event"))).toBe(true);
    }
  });

  it("routes the pre-request refusal to the verification read, which proves the mirror present and names the run", async () => {
    const [cycle] = await runCycles(1);

    expect(clientMocks.verifyCalendarObjectsByUrls).toHaveBeenCalledTimes(1);
    expect(clientMocks.verifyCalendarObjectsByUrls.mock.calls[0]?.[0]?.objectUrls)
      .toEqual([serverObjectUrl]);
    expect(liveObjectStillHoldsThePreviousEvent()).toBe(true);
    expect(cycle?.errors.some((error) =>
      error.includes(MAPPING_ID) && error.includes("still present")))
      .toBe(true);
  });

  it("never removes the object while the recreate is failing", async () => {
    clientMocks.createCalendarObject.mockRejectedValue(
      new CalDAVHttpError(new Response(null, { status: 403, statusText: "Forbidden" }), "create"),
    );

    const cycles = await runCycles(CYCLES);

    for (const cycle of cycles) {
      expect({ added: cycle.added, removed: cycle.removed }).toEqual({ added: 0, removed: 0 });
    }
    expect(liveObjectStillHoldsThePreviousEvent()).toBe(true);
    expect(clientMocks.deleteCalendarObjectByUrl).not.toHaveBeenCalled();
  });
});
