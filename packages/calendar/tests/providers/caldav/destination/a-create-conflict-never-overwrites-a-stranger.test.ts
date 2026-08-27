import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateDeterministicEventUid } from "../../../../src/core/events/identity";
import type { MaterializedSyncableEvent } from "../../../../src/core/types";
import { createCalDAVSyncProvider } from "../../../../src/providers/caldav/destination/provider";
import { CalDAVCreateConflictError } from "../../../../src/providers/caldav/shared/client";
import { eventToICalString } from "../../../../src/providers/caldav/shared/ics";

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

const ourEvent = (): MaterializedSyncableEvent => ({
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-03-08T15:00:00.000Z"),
  id: "event-state-id-1",
  sourceEventUid: "source-event-uid-1",
  startTime: new Date("2026-03-08T14:00:00.000Z"),
  summary: "Our meeting",
});

const strangersEvent = (): MaterializedSyncableEvent => ({
  calendarId: "someone-elses-calendar",
  calendarName: "Theirs",
  calendarUrl: null,
  endTime: new Date("2026-03-08T15:00:00.000Z"),
  id: "event-state-id-belonging-to-someone-else",
  sourceEventUid: "their-source-uid",
  startTime: new Date("2026-03-08T14:00:00.000Z"),
  summary: "Their meeting",
});

const createProvider = () =>
  createCalDAVSyncProvider({
    calendarUrl: "https://caldav.example.com/calendar/",
    password: "pass",
    serverUrl: "https://caldav.example.com",
    username: "user",
  });

const conflictOnCreate = (): void => {
  clientMocks.createCalendarObject.mockRejectedValueOnce(
    new CalDAVCreateConflictError(new Response(null, { status: 412 })),
  );
};

describe("a create conflict never overwrites a stranger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientMocks.resolveCalendarUrl.mockImplementation((url: string) => Promise.resolve(url));
    clientMocks.createCalendarObject.mockResolvedValue(null);
    clientMocks.deleteCalendarObject.mockResolvedValue(null);
  });

  it("does not delete an object carrying a uid that is not this event's", async () => {
    const theirUid = generateDeterministicEventUid(strangersEvent().id);
    conflictOnCreate();
    clientMocks.fetchCalendarObject.mockResolvedValueOnce({
      data: eventToICalString(strangersEvent(), theirUid),
      etag: "\"their-etag\"",
      url: "https://caldav.example.com/calendar/whatever.ics",
    });

    const [result] = await createProvider().pushEvents([ourEvent()]);

    expect(clientMocks.deleteCalendarObject).not.toHaveBeenCalled();
    expect(result?.success).toBe(false);
  });

  it("does not delete an object it could not parse at all", async () => {
    conflictOnCreate();
    clientMocks.fetchCalendarObject.mockResolvedValueOnce({
      data: "this is not a calendar object",
      etag: "\"unreadable-etag\"",
      url: "https://caldav.example.com/calendar/whatever.ics",
    });

    const [result] = await createProvider().pushEvents([ourEvent()]);

    expect(clientMocks.deleteCalendarObject).not.toHaveBeenCalled();
    expect(result?.success).toBe(false);
  });

  it("still replaces our own object when its content has drifted", async () => {
    const ourUid = generateDeterministicEventUid(ourEvent().id);
    conflictOnCreate();
    clientMocks.fetchCalendarObject.mockResolvedValueOnce({
      data: eventToICalString({ ...ourEvent(), summary: "Our meeting, older title" }, ourUid),
      etag: "\"our-etag\"",
      url: "https://caldav.example.com/calendar/whatever.ics",
    });

    const [result] = await createProvider().pushEvents([ourEvent()]);

    expect(clientMocks.deleteCalendarObject).toHaveBeenCalledTimes(1);
    expect(result?.success).toBe(true);
    expect(result?.conflictResolved).toBe(true);
  });
});
