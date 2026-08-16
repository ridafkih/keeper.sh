import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateDeterministicEventUid } from "../../../../src/core/events/identity";
import { createCalDAVSyncProvider } from "../../../../src/providers/caldav/destination/provider";

const clientMocks = vi.hoisted(() => ({
  createCalendarObject: vi.fn(),
  deleteCalendarObject: vi.fn(),
  fetchCalendarObject: vi.fn(),
  fetchCalendarObjects: vi.fn(),
  resolveCalendarUrl: vi.fn(),
}));

vi.mock("../../../../src/providers/caldav/shared/client", () => {
  class CalDAVClient {
    createCalendarObject = clientMocks.createCalendarObject;
    deleteCalendarObject = clientMocks.deleteCalendarObject;
    fetchCalendarObject = clientMocks.fetchCalendarObject;
    fetchCalendarObjects = clientMocks.fetchCalendarObjects;
    resolveCalendarUrl = clientMocks.resolveCalendarUrl;
  }

  class CalDAVHttpError extends Error {
    status = 0;
  }

  class CalDAVCreateConflictError extends CalDAVHttpError {}

  return { CalDAVClient, CalDAVCreateConflictError, CalDAVHttpError };
});

const TIME_MIN = new Date("2026-03-08T00:00:00.000Z");

const buildResource = (uid: string, start: string, end: string): string =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:Busy\r\nDTSTART:${start}\r\nDTEND:${end}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

const createProvider = () =>
  createCalDAVSyncProvider({
    calendarUrl: "https://caldav.example.com/calendar/",
    password: "pass",
    serverUrl: "https://caldav.example.com",
    username: "user",
  });

const listWithResource = (uid: string, start: string, end: string) => {
  clientMocks.resolveCalendarUrl.mockResolvedValueOnce("https://caldav.example.com/calendar/");
  clientMocks.fetchCalendarObjects.mockResolvedValueOnce([{
    data: buildResource(uid, start, end),
    url: `https://caldav.example.com/calendar/${uid}.ics`,
  }]);

  return createProvider().listRemoteEvents({ timeMin: TIME_MIN });
};

describe("caldav reconciliation read of a degenerate remote range", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports a Keeper resource whose start is inside the window and whose end predates it", async () => {
    const uid = generateDeterministicEventUid("event-state-id-1");

    const { items: remoteEvents } = await listWithResource(uid, "20260320T160000Z", "20260305T160000Z");

    expect(remoteEvents.map((event) => event.uid)).toEqual([uid]);
  });

  it("reports a zero-duration Keeper resource sitting exactly on the window's lower bound", async () => {
    const uid = generateDeterministicEventUid("event-state-id-2");

    const { items: remoteEvents } = await listWithResource(uid, "20260308T000000Z", "20260308T000000Z");

    expect(remoteEvents.map((event) => event.uid)).toEqual([uid]);
  });

  it("still skips a Keeper resource whose whole range predates the window", async () => {
    const uid = generateDeterministicEventUid("event-state-id-3");

    const { items: remoteEvents } = await listWithResource(uid, "20260301T090000Z", "20260301T100000Z");

    expect(remoteEvents).toEqual([]);
  });
});
