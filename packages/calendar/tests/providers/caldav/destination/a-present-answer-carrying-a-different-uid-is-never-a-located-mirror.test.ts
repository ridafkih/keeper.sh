import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateDeterministicEventUid } from "../../../../src/core/events/identity";
import type { EventPresence, EventVerificationTarget } from "../../../../src/core/types";
import { createCalDAVSyncProvider } from "../../../../src/providers/caldav/destination/provider";

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

const FIRST_UID = generateDeterministicEventUid("event-state-id-first");
const SECOND_UID = generateDeterministicEventUid("event-state-id-second");
const SHARED_PATH = `/calendar/${FIRST_UID}.ics`;

const icsLines = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Keeper//Keeper Calendar//EN",
  "BEGIN:VEVENT",
  `UID:${FIRST_UID}`,
  "DTSTAMP:20260301T090000Z",
  "DTSTART:20260308T140000Z",
  "DTEND:20260308T150000Z",
  "SUMMARY:Interview with the candidate",
  "END:VEVENT",
  "BEGIN:VEVENT",
  `UID:${SECOND_UID}`,
  "DTSTAMP:20260301T090000Z",
  "DTSTART:20260309T140000Z",
  "DTEND:20260309T150000Z",
  "SUMMARY:Retro",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
];

const SHARED_OBJECT_ICS = icsLines.join("\r\n");

const createProvider = () =>
  createCalDAVSyncProvider({
    calendarUrl: CALENDAR_URL,
    password: "pass",
    serverUrl: "https://caldav.example.test",
    username: "user",
  });

const verificationOf = (): (targets: EventVerificationTarget[]) => Promise<EventPresence[]> => {
  const provider = createProvider() as unknown as {
    verifyEventsExist?: (targets: EventVerificationTarget[]) => Promise<EventPresence[]>;
  };
  if (!provider.verifyEventsExist) {
    throw new Error("CalDAV destination provider does not implement verifyEventsExist");
  }
  return provider.verifyEventsExist;
};

describe("a present answer carrying a different uid is never a located mirror", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientMocks.resolveCalendarUrl.mockResolvedValue(CALENDAR_URL);
    clientMocks.verifyCalendarObjectsByUrls.mockResolvedValue([
      {
        data: SHARED_OBJECT_ICS,
        path: `${CALENDAR_URL}${FIRST_UID}.ics`,
        presence: "present",
      },
    ]);
  });

  it("never answers about the first VEVENT when it was asked about a different uid", async () => {
    const [presence] = await verificationOf()([{ deleteId: SHARED_PATH, uid: SECOND_UID }]);

    expect(presence?.status).toBe("unknown");
    expect(presence?.event?.uid).not.toBe(FIRST_UID);
  });

  it("still answers present about the uid it was actually asked for", async () => {
    const [presence] = await verificationOf()([{ deleteId: SHARED_PATH, uid: FIRST_UID }]);

    expect(presence?.status).toBe("present");
    expect(presence?.event?.uid).toBe(FIRST_UID);
    expect(presence?.event?.deleteId).toBe(SHARED_PATH);
  });
});
