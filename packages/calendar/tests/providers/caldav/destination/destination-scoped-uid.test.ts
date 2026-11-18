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

const legacyUid = generateDeterministicEventUid(event.id);

const createProvider = (calendarUrl: string) =>
  createCalDAVSyncProvider({
    calendarId: "destination-calendar-id",
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

const pushedUid = (calendarUrl: string): string | undefined => {
  const call = clientMocks.createCalendarObject.mock.calls.find(
    ([params]) => params?.calendarUrl === calendarUrl,
  );
  return call?.[0]?.filename;
};

describe("a source event mirrored into several calendars of one account", () => {
  it("gives each destination calendar its own UID", async () => {
    clientMocks.createCalendarObject.mockImplementation(() => Promise.resolve());
    const first = "https://caldav.example.com/home/first/";
    const second = "https://caldav.example.com/home/second/";

    await createProvider(first).pushEvents([event]);
    await createProvider(second).pushEvents([event]);

    expect(pushedUid(first)).toBeDefined();
    expect(pushedUid(second)).toBeDefined();
    expect(pushedUid(first)).not.toBe(pushedUid(second));
  });

  it("keeps the UID stable for the same destination calendar", async () => {
    clientMocks.createCalendarObject.mockImplementation(() => Promise.resolve());
    const calendarUrl = "https://caldav.example.com/home/first/";

    const [first] = await createProvider(calendarUrl).pushEvents([event]);
    const [second] = await createProvider(calendarUrl).pushEvents([event]);

    expect(first?.remoteId).toBe(second?.remoteId);
  });

  it("still updates an object written under the UID that predates destination scoping", async () => {
    const provider = createProvider("https://caldav.example.com/calendar/");

    const [result] = await provider.updateEvents?.([
      { deleteId: `/calendar/${legacyUid}.ics`, event },
    ]) ?? [];

    expect(result?.success).toBe(true);
    expect(clientMocks.updateCalendarObjectByUrl.mock.calls[0]?.[0]?.iCalString)
      .toContain(`UID:${legacyUid}`);
  });
});
