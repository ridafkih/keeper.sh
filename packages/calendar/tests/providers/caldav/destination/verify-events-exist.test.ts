import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateDeterministicEventUid } from "../../../../src/core/events/identity";
import type { EventPresence, MaterializedSyncableEvent } from "../../../../src/core/types";
import { createCalDAVSyncProvider } from "../../../../src/providers/caldav/destination/provider";
import { CalDAVHttpError } from "../../../../src/providers/caldav/shared/client";
import { eventToICalString } from "../../../../src/providers/caldav/shared/ics";

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

const CALENDAR_URL = "https://caldav.example.test/calendar/";

const createEvent = (id: string): MaterializedSyncableEvent => ({
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-03-08T15:00:00.000Z"),
  id,
  sourceEventUid: `source-event-uid-${id}`,
  startTime: new Date("2026-03-08T14:00:00.000Z"),
  summary: "Meeting",
});

const presentEvent = createEvent("event-state-id-present");
const PRESENT_UID = generateDeterministicEventUid(presentEvent.id);
const DELETED_UID = generateDeterministicEventUid("event-state-id-deleted");
const PRESENT_PATH = `/calendar/${PRESENT_UID}.ics`;
const DELETED_PATH = `/calendar/${DELETED_UID}.ics`;

const createProvider = () =>
  createCalDAVSyncProvider({
    calendarUrl: CALENDAR_URL,
    password: "pass",
    serverUrl: "https://caldav.example.test",
    username: "user",
  });

const verificationOf = (): (deleteIds: string[]) => Promise<EventPresence[]> => {
  const provider = createProvider() as unknown as {
    verifyEventsExist?: (deleteIds: string[]) => Promise<EventPresence[]>;
  };
  if (!provider.verifyEventsExist) {
    throw new Error("CalDAV destination provider does not implement verifyEventsExist");
  }
  return provider.verifyEventsExist;
};

const httpError = (status: number): Error =>
  new CalDAVHttpError(new Response(null, { status }), "delete");

const statusesOf = (presences: EventPresence[]): string[] =>
  presences.map((presence) => presence.status);

describe("CalDAV destination verifyEventsExist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientMocks.resolveCalendarUrl.mockResolvedValue(CALENDAR_URL);
  });

  it("reads the objects with a single multiget and reports a 404 answer as absent", async () => {
    clientMocks.verifyCalendarObjectsByUrls.mockResolvedValueOnce([
      {
        data: eventToICalString(presentEvent, PRESENT_UID),
        path: `${CALENDAR_URL}${PRESENT_UID}.ics`,
        presence: "present",
      },
      { data: null, path: `${CALENDAR_URL}${DELETED_UID}.ics`, presence: "absent" },
    ]);

    const presences = await verificationOf()([PRESENT_PATH, DELETED_PATH]);

    expect(presences).toEqual([
      {
        event: expect.objectContaining({ deleteId: PRESENT_PATH, uid: PRESENT_UID }),
        identifier: PRESENT_PATH,
        status: "present",
      },
      { identifier: DELETED_PATH, status: "absent" },
    ]);
    expect(clientMocks.verifyCalendarObjectsByUrls).toHaveBeenCalledTimes(1);
  });

  it("reports an href the multiget never answered as could-not-determine", async () => {
    clientMocks.verifyCalendarObjectsByUrls.mockResolvedValueOnce([
      {
        data: eventToICalString(presentEvent, PRESENT_UID),
        path: `${CALENDAR_URL}${PRESENT_UID}.ics`,
        presence: "present",
      },
    ]);

    const presences = await verificationOf()([PRESENT_PATH, DELETED_PATH]);

    expect(statusesOf(presences)).toEqual(["present", "unknown"]);
  });

  it("reports a 403 as could-not-determine, never as absent", async () => {
    clientMocks.verifyCalendarObjectsByUrls.mockRejectedValueOnce(httpError(403));

    const presences = await verificationOf()([PRESENT_PATH, DELETED_PATH]);

    expect(statusesOf(presences)).toEqual(["unknown", "unknown"]);
    expect(presences).toEqual([
      { identifier: PRESENT_PATH, status: "unknown" },
      { identifier: DELETED_PATH, status: "unknown" },
    ]);
  });

  it("reports a 503 as could-not-determine, never as absent", async () => {
    clientMocks.verifyCalendarObjectsByUrls.mockRejectedValueOnce(httpError(503));

    const presences = await verificationOf()([DELETED_PATH]);

    expect(presences).toEqual([{ identifier: DELETED_PATH, status: "unknown" }]);
  });

  it("reports a 429 as could-not-determine, never as absent", async () => {
    clientMocks.verifyCalendarObjectsByUrls.mockRejectedValueOnce(httpError(429));

    const presences = await verificationOf()([DELETED_PATH]);

    expect(presences).toEqual([{ identifier: DELETED_PATH, status: "unknown" }]);
  });

  it("reports a thrown error carrying no status as could-not-determine", async () => {
    clientMocks.verifyCalendarObjectsByUrls.mockRejectedValueOnce(new Error("socket hang up"));

    const presences = await verificationOf()([PRESENT_PATH, DELETED_PATH]);

    expect(statusesOf(presences)).toEqual(["unknown", "unknown"]);
  });

  it("reports a failure to resolve the calendar collection as could-not-determine", async () => {
    clientMocks.resolveCalendarUrl.mockReset();
    clientMocks.resolveCalendarUrl.mockRejectedValueOnce(httpError(503));

    const presences = await verificationOf()([DELETED_PATH]);

    expect(presences).toEqual([{ identifier: DELETED_PATH, status: "unknown" }]);
    expect(clientMocks.verifyCalendarObjectsByUrls).not.toHaveBeenCalled();
  });

  it("asks the server for nothing when there is nothing to verify", async () => {
    const presences = await verificationOf()([]);

    expect(presences).toEqual([]);
    expect(clientMocks.verifyCalendarObjectsByUrls).not.toHaveBeenCalled();
  });
});
