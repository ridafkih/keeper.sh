import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateDeterministicEventUid } from "../../../../src/core/events/identity";
import type { EventMapping } from "../../../../src/core/events/mappings";
import { executeRemoteOperations } from "../../../../src/core/sync-engine/index";
import type { MaterializedSyncableEvent, SyncOperation } from "../../../../src/core/types";
import { createCalDAVSyncProvider } from "../../../../src/providers/caldav/destination/provider";

const clientMocks = vi.hoisted(() => ({
  createCalendarObject: vi.fn(),
  deleteCalendarObject: vi.fn(),
  deleteCalendarObjectByUrl: vi.fn(),
  fetchCalendarObject: vi.fn(),
  fetchCalendarObjects: vi.fn(),
  resolveCalendarUrl: vi.fn(),
}));

vi.mock("../../../../src/providers/caldav/shared/client", () => {
  class MockCalDAVHttpError extends Error {
    status: number;

    constructor(response: Response) {
      super(`CalDAV request failed: ${response.status}`);
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
    resolveCalendarUrl = clientMocks.resolveCalendarUrl;
  }

  return {
    CalDAVClient,
    CalDAVCreateConflictError: MockCalDAVCreateConflictError,
    CalDAVHttpError: MockCalDAVHttpError,
  };
});

const event: MaterializedSyncableEvent = {
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-03-08T15:00:00.000Z"),
  id: "event-state-id-1",
  sourceEventUid: "source-event-uid-1",
  startTime: new Date("2026-03-08T14:00:00.000Z"),
  summary: "Renamed meeting",
};

const uid = generateDeterministicEventUid(event.id);

const mapping: EventMapping = {
  calendarId: "dest-calendar-id",
  deleteIdentifier: `/calendar/${uid}.ics`,
  destinationEventUid: uid,
  endTime: event.endTime,
  eventStateId: event.id,
  id: "mapping-1",
  sourceCalendarId: event.calendarId,
  startTime: event.startTime,
  syncEventHash: "diverged-remote-hash",
  syncEventId: event.id,
};

const replacement: SyncOperation = {
  deleteId: mapping.deleteIdentifier,
  event,
  staleMappingId: mapping.id,
  type: "replace",
  uid,
};

const createProvider = () =>
  createCalDAVSyncProvider({
    calendarUrl: "https://caldav.example.com/calendar/",
    password: "pass",
    serverUrl: "https://caldav.example.com",
    username: "user",
  });

describe("CalDAV replace with an update-capable provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rewrites the existing object with a single PUT and no DELETE", async () => {
    clientMocks.createCalendarObject.mockResolvedValue(null);
    clientMocks.deleteCalendarObject.mockResolvedValue(null);
    clientMocks.deleteCalendarObjectByUrl.mockResolvedValue(null);

    await executeRemoteOperations([replacement], [mapping], "dest-calendar-id", createProvider());

    expect(clientMocks.deleteCalendarObject).not.toHaveBeenCalled();
    expect(clientMocks.deleteCalendarObjectByUrl).not.toHaveBeenCalled();
    expect(clientMocks.createCalendarObject).toHaveBeenCalledTimes(1);
    expect(clientMocks.createCalendarObject.mock.calls[0]?.[0]).toMatchObject({
      calendarUrl: "https://caldav.example.com/calendar/",
      filename: `${uid}.ics`,
    });
    expect(clientMocks.createCalendarObject.mock.calls[0]?.[0]?.iCalString).toContain(`UID:${uid}`);
  });
});
