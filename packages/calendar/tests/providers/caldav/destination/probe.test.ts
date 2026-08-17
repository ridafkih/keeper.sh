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

const CALENDAR_URL = "https://caldav.example.com/calendar/";
const NOT_FOUND = 404;
const SERVER_ERROR = 503;

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

const createProvider = () =>
  createCalDAVSyncProvider({
    calendarUrl: CALENDAR_URL,
    password: "pass",
    serverUrl: "https://caldav.example.com",
    username: "user",
  });

const probe = (uid: string): Promise<string> => {
  const provider = createProvider() as unknown as {
    probeRemoteEvent?: (
      reference: { deleteId: string; uid: string },
    ) => Promise<string>;
  };
  if (!provider.probeRemoteEvent) {
    throw new Error("The CalDAV destination provider cannot confirm a copy is gone");
  }
  return provider.probeRemoteEvent({ deleteId: uid, uid });
};

describe("CalDAV destination: confirming a copy is really gone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientMocks.resolveCalendarUrl.mockResolvedValue(CALENDAR_URL);
    clientMocks.discoverCalendars.mockResolvedValue([{ displayName: "Mirror", url: CALENDAR_URL }]);
  });

  it("reports absent when the object is not on the server", async () => {
    const uid = generateDeterministicEventUid("event-state-id-1");
    clientMocks.fetchCalendarObject.mockResolvedValueOnce(null);
    clientMocks.fetchCalendarObjects.mockResolvedValueOnce([]);

    await expect(probe(uid)).resolves.toBe("absent");
    expect(clientMocks.fetchCalendarObject).toHaveBeenCalledWith({
      calendarUrl: CALENDAR_URL,
      filename: `${uid}.ics`,
    });
  });

  it("reports present when the object is still on the server", async () => {
    const uid = generateDeterministicEventUid("event-state-id-1");
    clientMocks.fetchCalendarObject.mockResolvedValueOnce({
      data: eventToICalString(createEvent(), uid),
      etag: "etag-1",
      url: `${CALENDAR_URL}${uid}.ics`,
    });

    await expect(probe(uid)).resolves.toBe("present");
  });

  it("reports present for a cancelled object the list read silently dropped", async () => {
    const uid = generateDeterministicEventUid("event-state-id-1");
    const cancelled = eventToICalString(createEvent(), uid).replace(
      "END:VEVENT",
      "STATUS:CANCELLED\r\nEND:VEVENT",
    );
    clientMocks.fetchCalendarObjects.mockResolvedValueOnce([{
      data: cancelled,
      url: `${CALENDAR_URL}${uid}.ics`,
    }]);
    clientMocks.fetchCalendarObject.mockResolvedValueOnce({
      data: cancelled,
      etag: "etag-1",
      url: `${CALENDAR_URL}${uid}.ics`,
    });

    const { items } = await createProvider().listRemoteEvents({
      timeMax: new Date("2099-01-01T00:00:00.000Z"),
      timeMin: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(items).toEqual([]);
    await expect(probe(uid)).resolves.toBe("present");
  });

  it("reports present for an object with no start time the list read silently dropped", async () => {
    const uid = generateDeterministicEventUid("event-state-id-1");
    const withoutStart = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:Meeting\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
    clientMocks.fetchCalendarObjects.mockResolvedValueOnce([{
      data: withoutStart,
      url: `${CALENDAR_URL}${uid}.ics`,
    }]);
    clientMocks.fetchCalendarObject.mockResolvedValueOnce({
      data: withoutStart,
      etag: "etag-1",
      url: `${CALENDAR_URL}${uid}.ics`,
    });

    const { items } = await createProvider().listRemoteEvents({
      timeMax: new Date("2099-01-01T00:00:00.000Z"),
      timeMin: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(items).toEqual([]);
    await expect(probe(uid)).resolves.toBe("present");
  });

  it("throws rather than answering absent when the server errors", async () => {
    const uid = generateDeterministicEventUid("event-state-id-1");
    clientMocks.fetchCalendarObject.mockRejectedValueOnce(
      new Error(`CalDAV request failed: ${SERVER_ERROR}`),
    );

    await expect(probe(uid)).rejects.toThrow();
  });

  it("treats a not-found response as a definitive absence", async () => {
    const uid = generateDeterministicEventUid("event-state-id-1");
    const notFound = new Error(`CalDAV request failed: ${NOT_FOUND}`);
    Object.assign(notFound, { name: "CalDAVHttpError", status: NOT_FOUND });
    clientMocks.fetchCalendarObject.mockRejectedValueOnce(notFound);
    clientMocks.fetchCalendarObjects.mockResolvedValueOnce([]);

    await expect(probe(uid)).resolves.toBe("absent");
  });

  it("refuses an empty multiget answer the collection listing contradicts", async () => {
    const uid = generateDeterministicEventUid("event-state-id-1");
    clientMocks.fetchCalendarObject.mockResolvedValueOnce(null);
    clientMocks.fetchCalendarObjects.mockResolvedValueOnce([{
      data: eventToICalString(createEvent(), uid),
      url: `${CALENDAR_URL}${uid}.ics`,
    }]);

    await expect(probe(uid)).resolves.toBe("present");
  });

  it("identifies a listed object by its own UID when its href cannot be parsed", async () => {
    const uid = generateDeterministicEventUid("event-state-id-1");
    clientMocks.fetchCalendarObject.mockResolvedValueOnce(null);
    clientMocks.fetchCalendarObjects.mockResolvedValueOnce([{
      data: eventToICalString(createEvent(), uid),
      url: "http://[",
    }]);

    await expect(probe(uid)).resolves.toBe("present");
  });

  it("refuses to answer when the collection listing is itself incomplete", async () => {
    const uid = generateDeterministicEventUid("event-state-id-1");
    clientMocks.fetchCalendarObject.mockResolvedValueOnce(null);
    clientMocks.fetchCalendarObjects.mockRejectedValueOnce(
      new Error("CalDAV multiget returned 4 of 9 requested objects"),
    );

    await expect(probe(uid)).rejects.toThrow("CalDAV multiget returned");
  });
  it("reads the same collection the list read resolved, not the stored one", async () => {
    const uid = generateDeterministicEventUid("event-state-id-1");
    const rehomed = "https://caldav.example.com/principals/user/calendar-2/";
    clientMocks.resolveCalendarUrl.mockResolvedValue(rehomed);
    clientMocks.fetchCalendarObject.mockResolvedValueOnce(null);
    clientMocks.fetchCalendarObjects.mockResolvedValueOnce([]);

    await expect(probe(uid)).resolves.toBe("absent");
    expect(clientMocks.fetchCalendarObject).toHaveBeenCalledWith({
      calendarUrl: rehomed,
      filename: `${uid}.ics`,
    });
  });

  it("refuses to answer when the collection itself cannot be resolved", async () => {
    const uid = generateDeterministicEventUid("event-state-id-1");
    clientMocks.resolveCalendarUrl.mockRejectedValueOnce(new Error("collection is gone"));

    await expect(probe(uid)).rejects.toThrow("collection is gone");
    expect(clientMocks.fetchCalendarObject).not.toHaveBeenCalled();
  });
});
