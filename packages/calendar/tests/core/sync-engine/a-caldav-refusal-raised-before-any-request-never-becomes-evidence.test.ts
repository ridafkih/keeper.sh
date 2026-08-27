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
const DESTINATION_CALENDAR_ID = "dest-cal-pre-request";
const CYCLES = 4;

const toUrl = (href: string): string => new URL(href, CALENDAR_URL).href;

const baseEvent = (
  id: string,
  summary: string,
): MaterializedSyncableEvent => ({
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-07-08T10:00:00.000Z"),
  id,
  sourceEventUid: `source-uid-${id}`,
  startTime: new Date("2026-07-08T09:00:00.000Z"),
  summary,
});

const SERVER_NAMED_HREF = "/calendars/user/shared/2f9c41d8-server-chosen.ics";
const SERVER_NAMED_URL = toUrl(SERVER_NAMED_HREF);
const STEADY_EVENT_ID = "event-state-server-named";
const steadyUid = generateDeterministicEventUid(STEADY_EVENT_ID);
const steadyStored = baseEvent(STEADY_EVENT_ID, "Weekly review");
const steadyEdited = baseEvent(STEADY_EVENT_ID, "Weekly review, edited");

const OLD_EVENT_ID = "occurrence-state-id-old";
const NEW_EVENT_ID = "occurrence-state-id-new";
const oldUid = generateDeterministicEventUid(OLD_EVENT_ID);
const newUid = generateDeterministicEventUid(NEW_EVENT_ID);
const REASSIGNED_HREF = `/calendars/user/shared/${oldUid}.ics`;
const REASSIGNED_URL = toUrl(REASSIGNED_HREF);
const occurrenceStored = baseEvent(OLD_EVENT_ID, "Team sync");
const occurrenceReassigned = baseEvent(NEW_EVENT_ID, "Team sync, reassigned occurrence");

const CONTROL_EVENT_ID = "event-state-answered-400";
const controlUid = generateDeterministicEventUid(CONTROL_EVENT_ID);
const CONTROL_HREF = `/calendars/user/shared/${controlUid}.ics`;
const CONTROL_URL = toUrl(CONTROL_HREF);
const controlStored = baseEvent(CONTROL_EVENT_ID, "Budget call");
const controlEdited = baseEvent(CONTROL_EVENT_ID, "Budget call, edited");

interface Scenario {
  event: MaterializedSyncableEvent;
  mapping: EventMapping;
  objectUrl: string;
  storedSummary: string;
}

const toMapping = (
  id: string,
  deleteIdentifier: string,
  destinationEventUid: string,
  syncEventId: string,
): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  consecutiveUpdateFailures: 0,
  deleteIdentifier,
  destinationEventUid,
  endTime: steadyStored.endTime,
  eventStateId: "series-owner-id",
  id,
  sourceCalendarId: "source-calendar-id",
  startTime: steadyStored.startTime,
  syncEventHash: "stale-hash",
  syncEventId,
});

const SERVER_NAMED_MAPPING_ID = "map-server-named";
const REASSIGNMENT_MAPPING_ID = "map-reassignment";
const CONTROL_MAPPING_ID = "map-answered-400";

const serverNamedScenario = (): Scenario => ({
  event: steadyEdited,
  mapping: toMapping(SERVER_NAMED_MAPPING_ID, SERVER_NAMED_HREF, steadyUid, STEADY_EVENT_ID),
  objectUrl: SERVER_NAMED_URL,
  storedSummary: steadyStored.summary,
});

const reassignmentScenario = (): Scenario => ({
  event: occurrenceReassigned,
  mapping: toMapping(REASSIGNMENT_MAPPING_ID, REASSIGNED_HREF, oldUid, OLD_EVENT_ID),
  objectUrl: REASSIGNED_URL,
  storedSummary: occurrenceStored.summary,
});

const controlScenario = (): Scenario => ({
  event: controlEdited,
  mapping: toMapping(CONTROL_MAPPING_ID, CONTROL_HREF, controlUid, CONTROL_EVENT_ID),
  objectUrl: CONTROL_URL,
  storedSummary: controlStored.summary,
});

const toReplace = (
  scenario: Scenario,
  mapping: EventMapping,
): Extract<SyncOperation, { type: "replace" }> => ({
  deleteId: mapping.deleteIdentifier,
  event: scenario.event,
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

const remoteObjects = new Map<string, string>();

const escapeIcsText = (value: string): string =>
  value.replaceAll(/(?<separator>[,;\\])/gu, String.raw`\$<separator>`);

const summaryOf = (iCalString: string): string =>
  /^SUMMARY:(?<summary>.*)$/mu.exec(iCalString)?.groups?.["summary"]?.trim() ?? "";

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

const liveObjectStillHoldsTheStoredEvent = (scenario: Scenario): boolean => {
  const stored = remoteObjects.get(scenario.objectUrl);
  if (!stored) {
    return false;
  }
  return summaryOf(stored) === escapeIcsText(scenario.storedSummary);
};

const liveObjectHoldsTheEditedEvent = (scenario: Scenario): boolean => {
  const stored = remoteObjects.get(scenario.objectUrl);
  if (!stored) {
    return false;
  }
  return summaryOf(stored) === escapeIcsText(scenario.event.summary);
};

type CalDAVWriteVerb = "create" | "delete" | "update";

const httpError = (status: number, statusText: string, operation: CalDAVWriteVerb): Error =>
  new CalDAVHttpError(new Response(null, { status, statusText }), operation);

const notFound = (operation: CalDAVWriteVerb): Error => httpError(404, "Not Found", operation);

interface CycleOutcome {
  added: number;
  counter: number;
  deleteCalls: number;
  deletedMappingIds: string[];
  errors: string[];
  insertedUids: string[];
  removed: number;
  verifyCalls: number;
}

interface CycleRun {
  carriedMapping: EventMapping;
  cycles: CycleOutcome[];
}

const runCycles = async (scenario: Scenario, cycleCount: number): Promise<CycleRun> => {
  const cycles: CycleOutcome[] = [];
  let { mapping } = scenario;
  const mappingId = mapping.id;

  for (let cycle = 0; cycle < cycleCount; cycle++) {
    const outcome = await executeRemoteOperations(
      [toReplace(scenario, mapping)],
      [mapping],
      DESTINATION_CALENDAR_ID,
      createProvider(),
    );

    const carried = (outcome.changes.updates ?? []).find((update) => update.id === mappingId);
    mapping = { ...mapping, ...carried, id: mappingId };

    cycles.push({
      added: outcome.result.added,
      counter: mapping.consecutiveUpdateFailures ?? 0,
      deleteCalls: clientMocks.deleteCalendarObjectByUrl.mock.calls.length
        + clientMocks.deleteCalendarObject.mock.calls.length,
      deletedMappingIds: outcome.changes.deletes,
      errors: outcome.errors.map((entry) => entry.error),
      insertedUids: outcome.changes.inserts.map((insert) => insert.destinationEventUid),
      removed: outcome.result.removed,
      verifyCalls: clientMocks.verifyCalendarObjectsByUrls.mock.calls.length,
    });
  }

  return { carriedMapping: mapping, cycles };
};

beforeEach(() => {
  for (const mock of Object.values(clientMocks)) {
    mock.mockReset();
  }
  remoteObjects.clear();
  remoteObjects.set(SERVER_NAMED_URL, eventToICalString(steadyStored, steadyUid));
  remoteObjects.set(REASSIGNED_URL, eventToICalString(occurrenceStored, oldUid));
  remoteObjects.set(CONTROL_URL, eventToICalString(controlStored, controlUid));

  clientMocks.resolveCalendarUrl.mockImplementation((url: string) => Promise.resolve(url));
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
      const objectUrl = `${calendarUrl}${filename}`;
      const heldAt = holderOfUid(iCalString, objectUrl);
      if (heldAt) {
        return Promise.reject(new CalDAVHttpError(
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
        ));
      }
      remoteObjects.set(objectUrl, iCalString);
      return Promise.resolve();
    },
  );
  clientMocks.updateCalendarObjectByUrl.mockImplementation(
    ({ iCalString, objectUrl }: { iCalString: string; objectUrl: string }) => {
      if (!remoteObjects.has(objectUrl)) {
        return Promise.reject(notFound("update"));
      }
      remoteObjects.set(objectUrl, iCalString);
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

describe("a CalDAV refusal raised before any request never becomes evidence", () => {
  it("rewrites the server-named object in place on every cycle, creating and deleting nothing", async () => {
    const scenario = serverNamedScenario();
    expect(SERVER_NAMED_HREF).not.toContain(steadyUid);

    const { carriedMapping, cycles } = await runCycles(scenario, CYCLES);

    expect(clientMocks.updateCalendarObjectByUrl).toHaveBeenCalledTimes(CYCLES);
    for (const call of clientMocks.updateCalendarObjectByUrl.mock.calls) {
      expect(call[0]?.objectUrl).toBe(SERVER_NAMED_URL);
    }
    expect(clientMocks.createCalendarObject).not.toHaveBeenCalled();
    expect(clientMocks.deleteCalendarObjectByUrl).not.toHaveBeenCalled();
    expect(clientMocks.deleteCalendarObject).not.toHaveBeenCalled();

    expect(liveObjectHoldsTheEditedEvent(scenario)).toBe(true);
    expect(uidOf(remoteObjects.get(SERVER_NAMED_URL) ?? "")).toBe(steadyUid);
    expect([...remoteObjects.keys()]).toContain(SERVER_NAMED_URL);

    for (const cycle of cycles) {
      expect({ added: cycle.added, counter: cycle.counter, removed: cycle.removed })
        .toEqual({ added: 0, counter: 0, removed: 0 });
      expect(cycle.deletedMappingIds).toEqual([]);
      expect(cycle.insertedUids).toEqual([]);
    }

    expect(carriedMapping.deleteIdentifier).toBe(SERVER_NAMED_HREF);
    expect(carriedMapping.syncEventHash).toBe(createSyncEventContentHash(scenario.event));
  });

  it("keeps the reassigned occurrence's object standing and its counter flat across four cycles", async () => {
    const scenario = reassignmentScenario();
    expect(REASSIGNED_HREF).not.toContain(newUid);

    const { cycles } = await runCycles(scenario, CYCLES);

    expect(clientMocks.deleteCalendarObjectByUrl).not.toHaveBeenCalled();
    expect(clientMocks.deleteCalendarObject).not.toHaveBeenCalled();
    expect(liveObjectStillHoldsTheStoredEvent(scenario)).toBe(true);
    for (const cycle of cycles) {
      expect({ added: cycle.added, counter: cycle.counter, removed: cycle.removed })
        .toEqual({ added: 0, counter: 0, removed: 0 });
      expect(cycle.errors.some((error) => error.includes(REASSIGNMENT_MAPPING_ID))).toBe(true);
    }
  });

  it("takes the read-first escape on the very first cycle and names the mirror it proved present", async () => {
    const scenario = reassignmentScenario();

    const { cycles: [cycle] } = await runCycles(scenario, 1);

    expect(clientMocks.verifyCalendarObjectsByUrls).toHaveBeenCalledTimes(1);
    expect(clientMocks.verifyCalendarObjectsByUrls.mock.calls[0]?.[0]?.objectUrls)
      .toEqual([REASSIGNED_URL]);
    expect(liveObjectStillHoldsTheStoredEvent(scenario)).toBe(true);
    expect(cycle?.errors.some((error) =>
      error.includes(REASSIGNMENT_MAPPING_ID) && error.includes("still present")))
      .toBe(true);
  });

  it("never removes the object while a recreate would be refused", async () => {
    const scenario = reassignmentScenario();
    clientMocks.createCalendarObject.mockRejectedValue(
      httpError(403, "Forbidden", "create"),
    );

    const { cycles } = await runCycles(scenario, CYCLES);

    for (const cycle of cycles) {
      expect({ added: cycle.added, removed: cycle.removed }).toEqual({ added: 0, removed: 0 });
    }
    expect(liveObjectStillHoldsTheStoredEvent(scenario)).toBe(true);
    expect(clientMocks.deleteCalendarObjectByUrl).not.toHaveBeenCalled();
  });

  it("negative control: a refusal the destination answered after the request went out is still durable", async () => {
    const scenario = controlScenario();
    clientMocks.updateCalendarObjectByUrl.mockRejectedValue(
      httpError(400, "Bad Request", "update"),
    );

    const { cycles } = await runCycles(scenario, 3);

    expect(cycles.map((cycle) => cycle.counter)).toEqual([1, 2, 0]);
    expect(cycles.map((cycle) => cycle.verifyCalls)).toEqual([0, 0, 1]);
    expect(cycles[2]?.errors.some((error) =>
      error.includes(CONTROL_MAPPING_ID) && error.includes("still present")))
      .toBe(true);
    expect(cycles.every((cycle) => cycle.deleteCalls === 0)).toBe(true);
    expect(liveObjectStillHoldsTheStoredEvent(scenario)).toBe(true);
  });
});
