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

const SERVER_URL = "https://caldav.example.com/";
const CALENDAR_URL = "https://caldav.example.com/calendars/user/shared/";

const oversizedSeries: MaterializedSyncableEvent = {
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-05-11T10:00:00.000Z"),
  id: "event-state-id-403",
  sourceEventUid: "source-event-uid-403",
  startTime: new Date("2026-05-11T09:00:00.000Z"),
  summary: "Quarterly planning, moved",
};

const uid = generateDeterministicEventUid(oversizedSeries.id);
const objectPath = `/calendars/user/shared/${uid}.ics`;
const objectUrl = `https://caldav.example.com${objectPath}`;

const mapping: EventMapping = {
  remoteAvailability: null,
  remoteContentHash: null,
  remoteEndTime: null,
  remoteStartTime: null,
  calendarId: "dest-cal-1",
  deleteIdentifier: objectPath,
  destinationEventUid: uid,
  endTime: oversizedSeries.endTime,
  eventStateId: oversizedSeries.id,
  id: "map-403",
  sourceCalendarId: "source-calendar-id",
  startTime: oversizedSeries.startTime,
  syncEventHash: "stale-hash",
  syncEventId: oversizedSeries.id,
};

const replacement: Extract<SyncOperation, { type: "replace" }> = {
  deleteId: objectPath,
  event: oversizedSeries,
  staleMappingId: mapping.id,
  type: "replace",
  uid,
};

// RFC 4791 5.3.2 payload preconditions: the server refuses these identical bytes on every request, PUT or recreate alike.
const payloadPreconditions = [
  { element: "C:max-resource-size", label: "max-resource-size" },
  { element: "C:min-date-time", label: "min-date-time" },
  { element: "C:max-date-time", label: "max-date-time" },
  { element: "C:max-instances", label: "max-instances" },
  { element: "C:max-attendees-per-instance", label: "max-attendees-per-instance" },
  { element: "C:valid-calendar-data", label: "valid-calendar-data" },
];

const preconditionBody = (element: string): string =>
  [
    "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
    "<D:error xmlns:D=\"DAV:\" xmlns:C=\"urn:ietf:params:xml:ns:caldav\">",
    `<${element}/>`,
    "</D:error>",
  ].join("");

const httpError = (status: number, statusText: string, body: string | null): Error =>
  new CalDAVHttpError(new Response(body, { status, statusText }), "update");

const createProvider = () =>
  createCalDAVSyncProvider({
    authMethod: "basic",
    calendarUrl: CALENDAR_URL,
    password: "password",
    serverUrl: SERVER_URL,
    username: "user",
  });

// A synthetic stand-in for the customer's calendar collection, so the assertion is about the remote object surviving rather than which calls were made.
const remoteObjects = new Map<string, string>();

beforeEach(() => {
  for (const mock of Object.values(clientMocks)) {
    mock.mockReset();
  }
  remoteObjects.clear();
  remoteObjects.set(objectUrl, "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");

  clientMocks.resolveCalendarUrl.mockImplementation((url: string) => Promise.resolve(url));
  clientMocks.deleteCalendarObjectByUrl.mockImplementation(
    ({ objectUrl: target }: { objectUrl: string }) => {
      remoteObjects.delete(target);
      return Promise.resolve();
    },
  );
  clientMocks.deleteCalendarObject.mockImplementation(
    ({ calendarUrl, filename }: { calendarUrl: string; filename: string }) => {
      remoteObjects.delete(`${calendarUrl}${filename}`);
      return Promise.resolve();
    },
  );
});

describe("a CalDAV 403 never destroys the customer's event", () => {
  for (const precondition of payloadPreconditions) {
    it(`leaves the remote object untouched after a 403 ${precondition.label}`, async () => {
      const refusal = () =>
        httpError(403, "Forbidden", preconditionBody(precondition.element));

      clientMocks.updateCalendarObjectByUrl.mockRejectedValue(refusal());
      // The recreate carries the same bytes, so the server refuses it the same way.
      clientMocks.createCalendarObject.mockRejectedValue(refusal());

      const provider = createProvider();

      const outcome = await executeRemoteOperations(
        [replacement],
        [mapping],
        "dest-cal-1",
        provider,
      ).catch(() => null);

      expect(clientMocks.updateCalendarObjectByUrl).toHaveBeenCalledTimes(1);
      expect(clientMocks.deleteCalendarObjectByUrl).not.toHaveBeenCalled();
      expect(clientMocks.deleteCalendarObject).not.toHaveBeenCalled();
      expect(clientMocks.createCalendarObject).not.toHaveBeenCalled();

      expect(remoteObjects.has(objectUrl)).toBe(true);

      expect(outcome?.changes.deletes ?? []).toEqual([]);
      expect(outcome?.changes.inserts ?? []).toEqual([]);
      expect(outcome?.changes.updates ?? []).toEqual([]);
    });
  }

  it("leaves the remote object untouched after an ACL-shaped 403 on a read-only calendar", async () => {
    clientMocks.updateCalendarObjectByUrl.mockRejectedValue(
      httpError(403, "Forbidden", preconditionBody("D:need-privileges")),
    );
    clientMocks.deleteCalendarObjectByUrl.mockRejectedValue(
      httpError(403, "Forbidden", null),
    );
    clientMocks.createCalendarObject.mockRejectedValue(httpError(403, "Forbidden", null));

    const provider = createProvider();

    const outcome = await executeRemoteOperations(
      [replacement],
      [mapping],
      "dest-cal-1",
      provider,
    ).catch(() => null);

    expect(clientMocks.deleteCalendarObjectByUrl).not.toHaveBeenCalled();
    expect(clientMocks.createCalendarObject).not.toHaveBeenCalled();
    expect(remoteObjects.has(objectUrl)).toBe(true);
    expect(outcome?.changes.deletes ?? []).toEqual([]);
    expect(outcome?.changes.inserts ?? []).toEqual([]);
  });
});
