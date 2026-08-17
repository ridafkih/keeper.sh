import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateDeterministicEventUid } from "../../../../src/core/events/identity";
import type { MaterializedSyncableEvent } from "../../../../src/core/types";
import { createCalDAVSyncProvider } from "../../../../src/providers/caldav/destination/provider";
import { CalDAVCreateConflictError, CalDAVHttpError } from "../../../../src/providers/caldav/shared/client";
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

  it("declares a CalDAV push echo uncomparable because PUT returns no body", async () => {
    clientMocks.createCalendarObject.mockResolvedValueOnce(null);

    const [result] = await createProvider().pushEvents([createEvent()]);

    expect(result?.success).toBe(true);
    expect(result?.echo).toEqual({ comparable: false, reason: "echo-body-missing" });
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

    const { items: remoteEvents } = await createProvider().listRemoteEvents({
      timeMax: new Date("2099-01-01T00:00:00.000Z"),
      timeMin: new Date("2026-07-10T00:00:00.000Z"),
    });

    expect(remoteEvents.map((event) => event.uid)).toEqual([keeperUid]);
    expect(clientMocks.fetchCalendarObjects).toHaveBeenCalledWith({
      calendarUrl: "https://caldav.example.com/calendar/",
      onListing: expect.any(Function),
      pathFilter: expect.any(Function),
    });
  });

  it("drops Keeper objects that start beyond the horizon", async () => {
    const beyondHorizon = createEvent({
      endTime: new Date("2040-03-15T10:00:00.000Z"),
      id: "beyond-horizon-event",
      startTime: new Date("2040-03-15T09:00:00.000Z"),
    });
    const insideHorizon = createEvent({
      endTime: new Date("2026-07-20T10:00:00.000Z"),
      id: "inside-horizon-event",
      startTime: new Date("2026-07-20T09:00:00.000Z"),
    });
    const beyondUid = generateDeterministicEventUid(beyondHorizon.id);
    const insideUid = generateDeterministicEventUid(insideHorizon.id);
    clientMocks.resolveCalendarUrl.mockResolvedValueOnce(
      "https://caldav.example.com/calendar/",
    );
    clientMocks.fetchCalendarObjects.mockResolvedValueOnce([{
      data: eventToICalString(beyondHorizon, beyondUid),
      url: `https://caldav.example.com/calendar/${beyondUid}.ics`,
    }, {
      data: eventToICalString(insideHorizon, insideUid),
      url: `https://caldav.example.com/calendar/${insideUid}.ics`,
    }]);

    const { items: remoteEvents } = await createProvider().listRemoteEvents({
      timeMax: new Date("2026-09-01T00:00:00.000Z"),
      timeMin: new Date("2026-07-10T00:00:00.000Z"),
    });

    expect(remoteEvents.map((event) => event.uid)).toEqual([insideUid]);
  });

  it("asks the server for Keeper-named objects only", async () => {
    const keeperUid = generateDeterministicEventUid("any-event-id");
    clientMocks.resolveCalendarUrl.mockResolvedValueOnce(
      "https://caldav.example.com/calendar/",
    );
    clientMocks.fetchCalendarObjects.mockResolvedValueOnce([]);

    await createProvider().listRemoteEvents({
      timeMax: new Date("2099-01-01T00:00:00.000Z"),
      timeMin: new Date("2026-07-10T00:00:00.000Z"),
    });

    const { pathFilter } = clientMocks.fetchCalendarObjects.mock.calls[0]?.[0] ?? {};
    expect(pathFilter(`/calendar/${keeperUid}.ics`)).toBe(true);
    expect(pathFilter(`/calendar/${encodeURIComponent(keeperUid)}.ics`)).toBe(true);
    expect(pathFilter("/calendar/user-owned.ics")).toBe(false);
    expect(pathFilter(`/calendar/${keeperUid}.txt`)).toBe(false);
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

    const { items: remoteEvents } = await createProvider().listRemoteEvents({
      timeMax: new Date("2099-01-01T00:00:00.000Z"),
      timeMin: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(remoteEvents.map((event) => event.uid)).toEqual([keeperUid]);
  });

  it("does not let an unrelated ranged override abort Keeper reconciliation", async () => {
    const keeperEvent = createEvent();
    const keeperUid = generateDeterministicEventUid(keeperEvent.id);
    const userSeriesWithRangedOverride = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:user-owned@example.com\r\nDTSTART:20260308T140000Z\r\nDTEND:20260308T150000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:user-owned@example.com\r\nRECURRENCE-ID;RANGE=THISANDFUTURE:20260309T140000Z\r\nDTSTART:20260309T160000Z\r\nDTEND:20260309T170000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
    clientMocks.resolveCalendarUrl.mockResolvedValueOnce(
      "https://caldav.example.com/calendar/",
    );
    clientMocks.fetchCalendarObjects.mockResolvedValueOnce([{
      data: userSeriesWithRangedOverride,
      url: "https://caldav.example.com/calendar/user-owned.ics",
    }, {
      data: eventToICalString(keeperEvent, keeperUid),
      url: `https://caldav.example.com/calendar/${keeperUid}.ics`,
    }]);

    const { items: remoteEvents } = await createProvider().listRemoteEvents({
      timeMax: new Date("2099-01-01T00:00:00.000Z"),
      timeMin: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(remoteEvents.map((event) => event.uid)).toEqual([keeperUid]);
  });

  it("does not let a malformed unrelated object abort Keeper reconciliation", async () => {
    const keeperEvent = createEvent();
    const keeperUid = generateDeterministicEventUid(keeperEvent.id);
    clientMocks.resolveCalendarUrl.mockResolvedValueOnce(
      "https://caldav.example.com/calendar/",
    );
    clientMocks.fetchCalendarObjects.mockResolvedValueOnce([{
      data: "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:user-owned@example.com\r\nDTSTART:not-a-date\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
      url: "https://caldav.example.com/calendar/malformed-user-event.ics",
    }, {
      data: eventToICalString(keeperEvent, keeperUid),
      url: `https://caldav.example.com/calendar/${keeperUid}.ics`,
    }]);

    const { items: remoteEvents } = await createProvider().listRemoteEvents({
      timeMax: new Date("2099-01-01T00:00:00.000Z"),
      timeMin: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(remoteEvents.map((event) => event.uid)).toEqual([keeperUid]);
  });

  it("does not hide a malformed Keeper-owned object", async () => {
    clientMocks.resolveCalendarUrl.mockResolvedValueOnce(
      "https://caldav.example.com/calendar/",
    );
    clientMocks.fetchCalendarObjects.mockResolvedValueOnce([{
      data: "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:malformed@keeper.sh\r\nDTSTART:not-a-date\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
      url: "https://caldav.example.com/calendar/malformed@keeper.sh.ics",
    }]);

    await expect(createProvider().listRemoteEvents({
      timeMax: new Date("2099-01-01T00:00:00.000Z"),
      timeMin: new Date("2026-01-01T00:00:00.000Z"),
    })).rejects.toThrow();
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

  it("lists a remote object's own path as its deleteId when the filename differs from the embedded UID", async () => {
    const event = createEvent();
    const embeddedUid = generateDeterministicEventUid(event.id);
    const fileUid = generateDeterministicEventUid("a-different-event");
    clientMocks.resolveCalendarUrl.mockResolvedValueOnce(
      "https://caldav.example.com/calendar/",
    );
    clientMocks.fetchCalendarObjects.mockResolvedValueOnce([{
      data: eventToICalString(event, embeddedUid),
      url: `https://caldav.example.com/calendar/${fileUid}.ics`,
    }]);

    const { items: remoteEvents } = await createProvider().listRemoteEvents({
      timeMax: new Date("2099-01-01T00:00:00.000Z"),
      timeMin: new Date("2026-03-01T00:00:00.000Z"),
    });

    expect(remoteEvents).toHaveLength(1);
    expect(remoteEvents[0]?.uid).toBe(embeddedUid);
    expect(remoteEvents[0]?.deleteId).toBe(`/calendar/${fileUid}.ics`);
  });

  it("deletes a swept remote object at its listed URL rather than a UID-derived filename", async () => {
    const event = createEvent();
    const embeddedUid = generateDeterministicEventUid(event.id);
    const fileUid = generateDeterministicEventUid("a-different-event");
    clientMocks.resolveCalendarUrl.mockResolvedValueOnce(
      "https://caldav.example.com/calendar/",
    );
    clientMocks.fetchCalendarObjects.mockResolvedValueOnce([{
      data: eventToICalString(event, embeddedUid),
      url: `https://caldav.example.com/calendar/${fileUid}.ics`,
    }]);
    clientMocks.deleteCalendarObjectByUrl.mockImplementationOnce(() => Promise.resolve());
    const provider = createProvider();
    const { items: remoteEvents } = await provider.listRemoteEvents({
      timeMax: new Date("2099-01-01T00:00:00.000Z"),
      timeMin: new Date("2026-03-01T00:00:00.000Z"),
    });
    const deleteId = remoteEvents[0]?.deleteId ?? "";

    const results = await provider.deleteEvents([deleteId]);

    expect(results).toEqual([{ success: true }]);
    expect(clientMocks.deleteCalendarObjectByUrl).toHaveBeenCalledWith({
      objectUrl: `https://caldav.example.com/calendar/${fileUid}.ics`,
    });
    expect(clientMocks.deleteCalendarObject).not.toHaveBeenCalled();
  });

  it("deletes a legacy UID deleteId at the calendar's UID-derived filename", async () => {
    const uid = generateDeterministicEventUid("legacy-event");
    clientMocks.deleteCalendarObject.mockImplementationOnce(() => Promise.resolve());
    const provider = createProvider();

    const results = await provider.deleteEvents([uid]);

    expect(results).toEqual([{ success: true }]);
    expect(clientMocks.deleteCalendarObject).toHaveBeenCalledWith({
      calendarUrl: "https://caldav.example.com/calendar/",
      filename: `${uid}.ics`,
    });
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

  it("counts a delete the server answers 404 apart from a delete that removed something", async () => {
    clientMocks.deleteCalendarObject
      .mockRejectedValueOnce(new CalDAVHttpError(new Response(null, { status: 404 }), "delete"))
      .mockResolvedValueOnce(null);
    const provider = createProvider();

    const results = await provider.deleteEvents(["gone-uid", "present-uid"]);

    expect(results).toEqual([{ success: true }, { success: true }]);
    expect(provider.getSyncDiagnostics()).toMatchObject({
      "events.remove_not_found": 1,
      "events.remove_succeeded": 1,
    });
  });

  it("breaks non-404 delete rejections out by status code", async () => {
    clientMocks.deleteCalendarObject
      .mockRejectedValueOnce(new CalDAVHttpError(new Response(null, { status: 403 }), "delete"))
      .mockRejectedValueOnce(new CalDAVHttpError(new Response(null, { status: 403 }), "delete"))
      .mockRejectedValueOnce(new CalDAVHttpError(new Response(null, { status: 405 }), "delete"));
    const provider = createProvider();

    await provider.deleteEvents(["a-uid", "b-uid", "c-uid"]);

    expect(provider.getSyncDiagnostics()).toMatchObject({
      "events.remove_failed_status.403": 2,
      "events.remove_failed_status.405": 1,
      "events.remove_not_found": 0,
    });
  });

  it("reports which delete identifier form each remove used", async () => {
    clientMocks.deleteCalendarObject.mockResolvedValue(null);
    const provider = createProvider();

    await provider.deleteEvents([
      "bare-uid@keeper.sh",
      "/calendar/an-object@keeper.sh.ics",
      "/calendar/another-object@keeper.sh.ics",
    ]);

    expect(provider.getSyncDiagnostics()).toMatchObject({
      "events.remove_by_path": 2,
      "events.remove_by_uid": 1,
    });
  });

  it("reports the CalDAV host so one server can be told apart from the fleet", () => {
    expect(createProvider().getSyncDiagnostics()).toMatchObject({
      "provider.caldav.host": "caldav.example.com",
    });
  });

  it("reports what the listing asked the server for against what it listed", async () => {
    clientMocks.resolveCalendarUrl.mockResolvedValueOnce("https://caldav.example.com/calendar/");
    clientMocks.fetchCalendarObjects.mockImplementationOnce(
      ({ onListing }: { onListing?: (stats: unknown) => void }) => {
        onListing?.({
          listedCount: 900,
          requestedCount: 12,
          returnedCount: 12,
          unrequestedCount: 4,
        });
        return Promise.resolve([]);
      },
    );
    const provider = createProvider();

    await provider.listRemoteEvents({ timeMax: new Date("2099-01-01T00:00:00.000Z"), timeMin: new Date("2026-03-01T00:00:00.000Z") });

    expect(provider.getSyncDiagnostics()).toMatchObject({
      "remote_objects.listed_count": 900,
      "remote_objects.requested_count": 12,
      "remote_objects.returned_count": 12,
      "remote_objects.unrequested_count": 4,
    });
  });

  it("omits listing counts until a listing has actually happened", () => {
    expect(createProvider().getSyncDiagnostics()).not.toHaveProperty("remote_objects.listed_count");
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
