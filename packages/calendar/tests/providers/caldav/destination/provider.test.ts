import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateDeterministicEventUid } from "../../../../src/core/events/identity";
import type { MaterializedSyncableEvent } from "../../../../src/core/types";
import { createCalDAVSyncProvider } from "../../../../src/providers/caldav/destination/provider";
import { CalDAVCreateConflictError, CalDAVHttpError } from "../../../../src/providers/caldav/shared/client";
import { eventToICalString } from "../../../../src/providers/caldav/shared/ics";

const clientMocks = vi.hoisted(() => ({
  createCalendarObject: vi.fn(),
  deleteCalendarObject: vi.fn(),
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
    calendarUrl: "https://caldav.example.com/calendar/",
    password: "pass",
    serverUrl: "https://caldav.example.com",
    username: "user",
  });

describe("createCalDAVSyncProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a provider with pushEvents, deleteEvents, and listRemoteEvents", () => {
    const provider = createProvider();

    expect(typeof provider.pushEvents).toBe("function");
    expect(typeof provider.deleteEvents).toBe("function");
    expect(typeof provider.listRemoteEvents).toBe("function");
  });

  it("lists far-future Keeper objects without imposing a two-year CalDAV report cutoff", async () => {
    const farFuture = createEvent({
      endTime: new Date("2040-03-15T10:00:00.000Z"),
      id: "far-future-event",
      startTime: new Date("2040-03-15T09:00:00.000Z"),
    });
    const keeperUid = generateDeterministicEventUid(farFuture.id);
    clientMocks.resolveCalendarUrl.mockResolvedValueOnce(
      "https://caldav.example.com/calendar/",
    );
    clientMocks.fetchCalendarObjects.mockResolvedValueOnce([{
      data: eventToICalString(farFuture, keeperUid),
      url: `https://caldav.example.com/calendar/${keeperUid}.ics`,
    }, {
      data: eventToICalString(farFuture, "user-owned@example.com"),
      url: "https://caldav.example.com/calendar/user-owned.ics",
    }]);

    const remoteEvents = await createProvider().listRemoteEvents({
      timeMin: new Date("2026-07-10T00:00:00.000Z"),
    });

    expect(remoteEvents.map((event) => event.uid)).toEqual([keeperUid]);
    expect(clientMocks.fetchCalendarObjects).toHaveBeenCalledWith({
      calendarUrl: "https://caldav.example.com/calendar/",
    });
  });

  it("does not let an unrelated user RDATE abort Keeper reconciliation", async () => {
    const keeperEvent = createEvent();
    const keeperUid = generateDeterministicEventUid(keeperEvent.id);
    const userEventWithRdate = eventToICalString(keeperEvent, "user-owned@example.com").replace(
      "END:VEVENT",
      "RDATE:20260401T090000Z\r\nEND:VEVENT",
    );
    clientMocks.resolveCalendarUrl.mockResolvedValueOnce(
      "https://caldav.example.com/calendar/",
    );
    clientMocks.fetchCalendarObjects.mockResolvedValueOnce([{
      data: userEventWithRdate,
      url: "https://caldav.example.com/calendar/user-owned.ics",
    }, {
      data: eventToICalString(keeperEvent, keeperUid),
      url: `https://caldav.example.com/calendar/${keeperUid}.ics`,
    }]);

    const remoteEvents = await createProvider().listRemoteEvents({
      timeMin: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(remoteEvents.map((event) => event.uid)).toEqual([keeperUid]);
  });

  it("restores the mapping when a create conflict contains identical event content", async () => {
    const event = createEvent();
    const existingData = eventToICalString(event, generateDeterministicEventUid(event.id));
    clientMocks.createCalendarObject.mockRejectedValueOnce(
      new CalDAVCreateConflictError(new Response(null, { status: 412 })),
    );
    clientMocks.fetchCalendarObject.mockResolvedValueOnce({
      data: existingData,
      etag: "etag-1",
      url: "https://caldav.example.com/calendar/existing-uid.ics",
    });
    const provider = createProvider();

    const results = await provider.pushEvents([event]);

    expect(results).toEqual([expect.objectContaining({ conflictResolved: true, success: true })]);
    expect(clientMocks.deleteCalendarObject).not.toHaveBeenCalled();
    expect(clientMocks.createCalendarObject).toHaveBeenCalledTimes(1);
  });

  it("deletes and recreates an event when a create conflict contains stale content", async () => {
    const previousEvent = createEvent();
    const movedEvent = createEvent({
      endTime: new Date("2026-03-08T17:00:00.000Z"),
      startTime: new Date("2026-03-08T16:00:00.000Z"),
    });
    clientMocks.createCalendarObject
      .mockRejectedValueOnce(new CalDAVCreateConflictError(new Response(null, { status: 412 })))
      .mockImplementationOnce(() => Promise.resolve());
    clientMocks.fetchCalendarObject.mockResolvedValueOnce({
      data: eventToICalString(previousEvent, generateDeterministicEventUid(previousEvent.id)),
      etag: "etag-1",
      url: "https://caldav.example.com/calendar/existing-uid.ics",
    });
    clientMocks.deleteCalendarObject.mockImplementationOnce(() => Promise.resolve());
    const provider = createProvider();

    const results = await provider.pushEvents([movedEvent]);

    expect(results).toEqual([expect.objectContaining({ conflictResolved: true, success: true })]);
    expect(clientMocks.deleteCalendarObject).toHaveBeenCalledWith(expect.objectContaining({
      etag: "etag-1",
    }));
    expect(clientMocks.createCalendarObject).toHaveBeenCalledTimes(2);
  });

  it("returns structured diagnostics for a failed CalDAV write", async () => {
    const event = createEvent();
    clientMocks.createCalendarObject.mockRejectedValueOnce(
      new CalDAVHttpError(new Response(null, { status: 503, statusText: "Service Unavailable" }), "create"),
    );
    const provider = createProvider();

    const results = await provider.pushEvents([event]);

    expect(results).toEqual([expect.objectContaining({
      errorType: "CalDAVHttpError",
      statusCode: 503,
      success: false,
    })]);
  });

  it("preserves the HTTP status and recovery phase when conflict recovery fails", async () => {
    const previousEvent = createEvent();
    const movedEvent = createEvent({
      startTime: new Date("2026-03-08T16:00:00.000Z"),
      endTime: new Date("2026-03-08T17:00:00.000Z"),
    });
    clientMocks.createCalendarObject.mockRejectedValueOnce(
      new CalDAVCreateConflictError(new Response(null, { status: 412 })),
    );
    clientMocks.fetchCalendarObject.mockResolvedValueOnce({
      data: eventToICalString(previousEvent, generateDeterministicEventUid(previousEvent.id)),
      etag: "etag-1",
    });
    clientMocks.deleteCalendarObject.mockRejectedValueOnce(
      new CalDAVHttpError(new Response(null, { status: 503, statusText: "Service Unavailable" }), "delete"),
    );
    const provider = createProvider();

    const results = await provider.pushEvents([movedEvent]);

    expect(results).toEqual([expect.objectContaining({
      error: expect.stringContaining("CalDAV create conflict recovery failed"),
      errorType: "CalDAVConflictRecoveryError",
      statusCode: 503,
      success: false,
    })]);
  });
});
