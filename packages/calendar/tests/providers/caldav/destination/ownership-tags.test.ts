import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateDeterministicEventUid } from "../../../../src/core/events/identity";
import type { MaterializedSyncableEvent } from "../../../../src/core/types";
import { createCalDAVSyncProvider } from "../../../../src/providers/caldav/destination/provider";
import { eventToICalString, readEventOwnerTag } from "../../../../src/providers/caldav/shared/ics";

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

describe("CalDAV destination ownership tags", () => {
  it("writes the destination calendar id into every object it creates", async () => {
    clientMocks.createCalendarObject.mockImplementation(() => Promise.resolve());

    await createProvider("https://caldav.example.com/calendar/").pushEvents([event]);

    const written = clientMocks.createCalendarObject.mock.calls[0]?.[0]?.iCalString;
    expect(readEventOwnerTag(written)).toBe("destination-calendar-id");
  });

  it("reads the tag of each listed object, and null for objects written before tags", async () => {
    const calendarUrl = "https://caldav.example.com/calendar/";
    const theirUid = generateDeterministicEventUid("their-event");
    clientMocks.fetchCalendarObjects.mockResolvedValueOnce([
      {
        data: eventToICalString(event, legacyUid),
        url: `${calendarUrl}${legacyUid}.ics`,
      },
      {
        data: eventToICalString(event, theirUid, "another-destination"),
        url: `${calendarUrl}${theirUid}.ics`,
      },
    ]);

    const remoteEvents = await createProvider(calendarUrl).listRemoteEvents({
      timeMax: new Date("2027-01-01T00:00:00.000Z"),
      timeMin: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(remoteEvents.map((remoteEvent) => [remoteEvent.uid, remoteEvent.ownerTag])).toEqual([
      [legacyUid, null],
      [theirUid, "another-destination"],
    ]);
  });

  it("claims an existing mirror by rewriting it in place with the tag", async () => {
    const provider = createProvider("https://caldav.example.com/calendar/");

    const [result] = await provider.claimEvents([{ deleteId: `/calendar/${legacyUid}.ics`, event }]);

    const written = clientMocks.updateCalendarObjectByUrl.mock.calls[0]?.[0]?.iCalString;
    expect(result?.success).toBe(true);
    expect(written).toContain(`UID:${legacyUid}`);
    expect(readEventOwnerTag(written)).toBe("destination-calendar-id");
  });
});
