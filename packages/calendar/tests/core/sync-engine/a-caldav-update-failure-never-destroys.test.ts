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

const CALENDAR_URL = "https://caldav.example.com/calendars/user/shared/";

const movedSeries: MaterializedSyncableEvent = {
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-03-15T10:00:00.000Z"),
  id: "event-state-id-1",
  sourceEventUid: "source-event-uid-1",
  startTime: new Date("2026-03-15T09:00:00.000Z"),
  summary: "Weekly standup, moved",
};

const uid = generateDeterministicEventUid(movedSeries.id);
const objectPath = `/calendars/user/shared/${uid}.ics`;

const mapping: EventMapping = {
  calendarId: "dest-cal-1",
  deleteIdentifier: objectPath,
  destinationEventUid: uid,
  endTime: movedSeries.endTime,
  eventStateId: movedSeries.id,
  id: "map-1",
  sourceCalendarId: "source-calendar-id",
  startTime: movedSeries.startTime,
  syncEventHash: "stale-hash",
  syncEventId: movedSeries.id,
};

const replacement: Extract<SyncOperation, { type: "replace" }> = {
  deleteId: objectPath,
  event: movedSeries,
  staleMappingId: mapping.id,
  type: "replace",
  uid,
};

const refusalBody = [
  "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
  "<D:error xmlns:D=\"DAV:\" xmlns:C=\"urn:ietf:params:xml:ns:caldav\">",
  "<C:valid-calendar-object-resource/>",
  "</D:error>",
].join("");

const updateFailures = [
  { body: refusalBody, label: "a 403 with a precondition error", status: 403, statusText: "Forbidden" },
  { body: refusalBody, label: "a 409 with a precondition error", status: 409, statusText: "Conflict" },
  { body: null, label: "a 503", status: 503, statusText: "Service Unavailable" },
  { body: null, label: "a throttle", status: 429, statusText: "Too Many Requests" },
  { body: null, label: "a timeout", status: 408, statusText: "Request Timeout" },
];

const httpError = (status: number, statusText: string, body: string | null): Error =>
  new CalDAVHttpError(new Response(body, { status, statusText }), "update");

const createProvider = () =>
  createCalDAVSyncProvider({
    authMethod: "basic",
    calendarUrl: CALENDAR_URL,
    password: "password",
    serverUrl: "https://caldav.example.com/",
    username: "user",
  });

beforeEach(() => {
  for (const mock of Object.values(clientMocks)) {
    mock.mockReset();
  }
  clientMocks.resolveCalendarUrl.mockImplementation((url: string) => Promise.resolve(url));
  clientMocks.createCalendarObject.mockImplementation(() => Promise.resolve());
  clientMocks.deleteCalendarObject.mockImplementation(() => Promise.resolve());
  clientMocks.deleteCalendarObjectByUrl.mockImplementation(() => Promise.resolve());
});

describe("a CalDAV update failure never destroys the customer's event", () => {
  for (const failure of updateFailures) {
    it(`leaves the event alone after ${failure.label}`, async () => {
      clientMocks.updateCalendarObjectByUrl.mockRejectedValue(
        httpError(failure.status, failure.statusText, failure.body),
      );
      const provider = createProvider();

      const outcome = await executeRemoteOperations(
        [replacement],
        [mapping],
        "dest-cal-1",
        provider,
      );

      expect(clientMocks.updateCalendarObjectByUrl).toHaveBeenCalledTimes(1);
      expect(clientMocks.deleteCalendarObjectByUrl).not.toHaveBeenCalled();
      expect(clientMocks.deleteCalendarObject).not.toHaveBeenCalled();
      expect(clientMocks.createCalendarObject).not.toHaveBeenCalled();
      expect(outcome.changes.deletes).toEqual([]);
      expect(outcome.changes.inserts).toEqual([]);
      expect(outcome.changes.updates ?? []).toEqual([]);
    });
  }

  it("leaves the event alone after a thrown network error", async () => {
    clientMocks.updateCalendarObjectByUrl.mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), { cause: new Error("socket hang up") }),
    );
    const provider = createProvider();

    const outcome = await executeRemoteOperations(
      [replacement],
      [mapping],
      "dest-cal-1",
      provider,
    ).catch(() => null);

    expect(clientMocks.deleteCalendarObjectByUrl).not.toHaveBeenCalled();
    expect(clientMocks.deleteCalendarObject).not.toHaveBeenCalled();
    expect(clientMocks.createCalendarObject).not.toHaveBeenCalled();
    expect(outcome?.changes.deletes ?? []).toEqual([]);
    expect(outcome?.changes.inserts ?? []).toEqual([]);
    expect(outcome?.changes.updates ?? []).toEqual([]);
  });
});
