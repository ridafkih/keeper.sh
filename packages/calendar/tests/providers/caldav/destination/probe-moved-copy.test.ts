import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateDeterministicEventUid } from "../../../../src/core/events/identity";
import type { MaterializedSyncableEvent } from "../../../../src/core/types";
import { createCalDAVSyncProvider } from "../../../../src/providers/caldav/destination/provider";
import { eventToICalString } from "../../../../src/providers/caldav/shared/ics";

const clientMocks = vi.hoisted(() => ({
  createCalendarObject: vi.fn(),
  deleteCalendarObject: vi.fn(),
  discoverCalendars: vi.fn(),
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
    discoverCalendars = clientMocks.discoverCalendars;
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

const CALENDAR_URL = "https://caldav.example.com/calendars/user/mirror/";
const SIBLING_URL = "https://caldav.example.com/calendars/user/personal/";

const createEvent = (
  overrides: Partial<MaterializedSyncableEvent> = {},
): MaterializedSyncableEvent => ({
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-03-08T15:00:00.000Z"),
  id: "event-state-id-1",
  sourceEventUid: "source-event-uid-1",
  startTime: new Date("2026-03-08T14:00:00.000Z"),
  summary: "Meeting",
  ...overrides,
});

const probe = (uid: string): Promise<string> => {
  const provider = createCalDAVSyncProvider({
    calendarUrl: CALENDAR_URL,
    password: "pass",
    serverUrl: "https://caldav.example.com",
    username: "user",
  }) as unknown as {
    probeRemoteEvent?: (
      reference: { deleteId: string; uid: string },
    ) => Promise<string>;
  };
  if (!provider.probeRemoteEvent) {
    throw new Error("The CalDAV destination provider cannot confirm a copy is gone");
  }
  return provider.probeRemoteEvent({ deleteId: uid, uid });
};

describe("CalDAV destination: a copy dragged into another collection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientMocks.resolveCalendarUrl.mockResolvedValue(CALENDAR_URL);
  });

  it("reports present when the copy now lives in a sibling collection of the account", async () => {
    const uid = generateDeterministicEventUid("event-state-id-1");
    const objectData = eventToICalString(createEvent(), uid);

    clientMocks.fetchCalendarObject.mockImplementation(
      ({ calendarUrl }: { calendarUrl: string; filename: string }) => {
        if (calendarUrl === SIBLING_URL) {
          return Promise.resolve({
            data: objectData,
            etag: "etag-1",
            url: `${SIBLING_URL}${uid}.ics`,
          });
        }
        return Promise.resolve(null);
      },
    );
    clientMocks.fetchCalendarObjects.mockImplementation(
      ({ calendarUrl }: { calendarUrl: string }) => {
        if (calendarUrl === SIBLING_URL) {
          return Promise.resolve([{ data: objectData, url: `${SIBLING_URL}${uid}.ics` }]);
        }
        return Promise.resolve([]);
      },
    );
    clientMocks.discoverCalendars.mockResolvedValue([
      { displayName: "Mirror", url: CALENDAR_URL },
      { displayName: "Personal", url: SIBLING_URL },
    ]);

    await expect(probe(uid)).resolves.toBe("present");
  });

  it("still reports absent once no collection in the account holds the copy", async () => {
    const uid = generateDeterministicEventUid("event-state-id-1");
    clientMocks.fetchCalendarObject.mockResolvedValue(null);
    clientMocks.fetchCalendarObjects.mockResolvedValue([]);
    clientMocks.discoverCalendars.mockResolvedValue([
      { displayName: "Mirror", url: CALENDAR_URL },
      { displayName: "Personal", url: SIBLING_URL },
    ]);

    await expect(probe(uid)).resolves.toBe("absent");
  });

  it("throws rather than answering absent when the account's collections cannot be listed", async () => {
    const uid = generateDeterministicEventUid("event-state-id-1");
    clientMocks.fetchCalendarObject.mockResolvedValue(null);
    clientMocks.fetchCalendarObjects.mockResolvedValue([]);
    clientMocks.discoverCalendars.mockRejectedValue(new Error("CalDAV request failed: 503"));

    await expect(probe(uid)).rejects.toThrow();
  });

  it("throws rather than answering absent when a sibling collection cannot be read", async () => {
    const uid = generateDeterministicEventUid("event-state-id-1");
    clientMocks.fetchCalendarObject.mockResolvedValue(null);
    clientMocks.fetchCalendarObjects.mockImplementation(
      ({ calendarUrl }: { calendarUrl: string }) => {
        if (calendarUrl === SIBLING_URL) {
          return Promise.reject(new Error("CalDAV request failed: 503"));
        }
        return Promise.resolve([]);
      },
    );
    clientMocks.discoverCalendars.mockResolvedValue([
      { displayName: "Mirror", url: CALENDAR_URL },
      { displayName: "Personal", url: SIBLING_URL },
    ]);

    await expect(probe(uid)).rejects.toThrow();
  });
});
