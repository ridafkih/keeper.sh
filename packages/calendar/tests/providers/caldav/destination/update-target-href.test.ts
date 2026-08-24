import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateDeterministicEventUid } from "../../../../src/core/events/identity";
import type { MaterializedSyncableEvent } from "../../../../src/core/types";
import { createCalDAVSyncProvider } from "../../../../src/providers/caldav/destination/provider";

const clientMocks = vi.hoisted(() => ({
  createCalendarObject: vi.fn(),
  deleteCalendarObject: vi.fn(),
  deleteCalendarObjectByUrl: vi.fn(),
  fetchCalendarObject: vi.fn(),
  fetchCalendarObjects: vi.fn(),
  resolveCalendarUrl: vi.fn(),
  updateCalendarObjectByUrl: vi.fn(),
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
    updateCalendarObjectByUrl = clientMocks.updateCalendarObjectByUrl;
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

const createProvider = (calendarUrl: string) =>
  createCalDAVSyncProvider({
    authMethod: "basic",
    calendarUrl,
    password: "password",
    serverUrl: "https://caldav.example.com/",
    username: "user",
  });

beforeEach(() => {
  for (const mock of Object.values(clientMocks)) {
    mock.mockReset();
  }
  clientMocks.updateCalendarObjectByUrl.mockImplementation(() => Promise.resolve());
  clientMocks.resolveCalendarUrl.mockImplementation((url: string) => Promise.resolve(url));
});

describe("resolving the in-place update target", () => {
  it("updates an object whose listed href percent-encodes the keeper suffix", async () => {
    const provider = createProvider("https://caldav.example.com/calendar/");
    const deleteId = `/calendar/${encodeURIComponent(uid)}.ics`;

    const [result] = await provider.updateEvents?.([{ deleteId, event }]) ?? [];

    expect(result?.success).toBe(true);
    expect(clientMocks.deleteCalendarObjectByUrl).not.toHaveBeenCalled();
    expect(clientMocks.updateCalendarObjectByUrl).toHaveBeenCalledTimes(1);
    expect(clientMocks.updateCalendarObjectByUrl.mock.calls[0]?.[0]?.objectUrl)
      .toBe(`https://caldav.example.com/calendar/${encodeURIComponent(uid)}.ics`);
  });

  it("updates when the configured calendar url has no trailing slash", async () => {
    const provider = createProvider("https://caldav.example.com/calendar");

    const [result] = await provider.updateEvents?.([{ deleteId: uid, event }]) ?? [];

    expect(result?.success).toBe(true);
    expect(clientMocks.updateCalendarObjectByUrl).toHaveBeenCalledTimes(1);
    expect(clientMocks.updateCalendarObjectByUrl.mock.calls[0]?.[0]?.objectUrl)
      .toBe(`https://caldav.example.com/calendar/${uid}.ics`);
  });

  it("refuses to write when the href is not this event's deterministic object", async () => {
    const provider = createProvider("https://caldav.example.com/calendar/");

    const [result] = await provider.updateEvents?.([
      { deleteId: "/calendar/somebody-elses-event.ics", event },
    ]) ?? [];

    expect(result?.success).toBe(false);
    expect(clientMocks.updateCalendarObjectByUrl).not.toHaveBeenCalled();
    expect(clientMocks.createCalendarObject).not.toHaveBeenCalled();
  });
});
