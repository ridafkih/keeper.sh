import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import { generateDeterministicEventUid } from "../../src/core/events/identity";
import type { MaterializedSyncableEvent, RemoteEvent } from "../../src/core/types";
import { createGoogleSyncProvider } from "../../src/providers/google/destination/provider";
import { createOutlookSyncProvider } from "../../src/providers/outlook/destination/provider";
import { createCalDAVSyncProvider } from "../../src/providers/caldav/destination/provider";
import { eventToICalString } from "../../src/providers/caldav/shared/ics";

interface NamedEventLookupProvider {
  getRemoteEventsByIds: (ids: string[]) => Promise<RemoteEvent[]>;
}

const asNamedLookup = (provider: unknown): NamedEventLookupProvider =>
  provider as NamedEventLookupProvider;

const PRESENT_UID_ONE = generateDeterministicEventUid("event-state-id-1");
const PRESENT_UID_TWO = generateDeterministicEventUid("event-state-id-2");

const googleResource = (eventId: string, uid: string) => ({
  end: { dateTime: "2026-03-15T10:00:00Z" },
  iCalUID: uid,
  id: eventId,
  start: { dateTime: "2026-03-15T09:00:00Z" },
  summary: "Meeting",
});

const createCalDAVEvent = (id: string): MaterializedSyncableEvent => ({
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-03-15T10:00:00.000Z"),
  id,
  sourceEventUid: `source-${id}`,
  startTime: new Date("2026-03-15T09:00:00.000Z"),
  summary: "Meeting",
});

const lastPathSegment = (pathname: string): string =>
  decodeURIComponent(pathname.split("/").at(-1) ?? "");

const batchMocks = vi.hoisted(() => ({
  executeBatchChunked: vi.fn(),
}));

vi.mock("../../src/providers/google/shared/batch", () => ({
  executeBatchChunked: batchMocks.executeBatchChunked,
}));

const caldavClientMocks = vi.hoisted(() => ({
  createCalendarObject: vi.fn(),
  deleteCalendarObject: vi.fn(),
  deleteCalendarObjectByUrl: vi.fn(),
  fetchCalendarObject: vi.fn(),
  fetchCalendarObjects: vi.fn(),
  fetchCalendarObjectsByUrls: vi.fn(),
  resolveCalendarUrl: vi.fn(),
  updateCalendarObjectByUrl: vi.fn(),
}));

vi.mock("../../src/providers/caldav/shared/client", () => {
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
    createCalendarObject = caldavClientMocks.createCalendarObject;
    deleteCalendarObject = caldavClientMocks.deleteCalendarObject;
    deleteCalendarObjectByUrl = caldavClientMocks.deleteCalendarObjectByUrl;
    fetchCalendarObject = caldavClientMocks.fetchCalendarObject;
    fetchCalendarObjects = caldavClientMocks.fetchCalendarObjects;
    fetchCalendarObjectsByUrls = caldavClientMocks.fetchCalendarObjectsByUrls;
    resolveCalendarUrl = caldavClientMocks.resolveCalendarUrl;
    updateCalendarObjectByUrl = caldavClientMocks.updateCalendarObjectByUrl;
  }

  return {
    CalDAVClient,
    CalDAVCreateConflictError: MockCalDAVCreateConflictError,
    CalDAVHttpError: MockCalDAVHttpError,
  };
});

describe("google destination named event lookup", () => {
  const requestedIds: string[] = [];

  const resourcesById = new Map([
    ["google-event-1", googleResource("google-event-1", PRESENT_UID_ONE)],
    ["google-event-2", googleResource("google-event-2", PRESENT_UID_TWO)],
  ]);

  const createProvider = () => createGoogleSyncProvider({
    accessToken: "test-token",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    calendarId: "cal-1",
    externalCalendarId: "primary",
    refreshToken: "test-refresh",
    userId: "user-1",
  });

  const installDoubles = (status: number): void => {
    batchMocks.executeBatchChunked.mockImplementation((requests: { path: string }[]) =>
      Promise.resolve(requests.map((request) => {
        const eventId = lastPathSegment(new URL(request.path, "https://www.googleapis.com").pathname);
        requestedIds.push(eventId);
        const resource = resourcesById.get(eventId);
        if (status !== 200) {
          return { body: { error: { message: "backend error" } }, headers: {}, statusCode: status };
        }
        if (!resource) {
          return { body: { error: { message: "Not Found" } }, headers: {}, statusCode: 404 };
        }
        return { body: resource, headers: {}, statusCode: 200 };
      })));

    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input));
      const eventId = lastPathSegment(url.pathname);
      requestedIds.push(eventId);
      const resource = resourcesById.get(eventId);
      if (status !== 200) {
        return Promise.resolve(Response.json({ error: { message: "backend error" } }, { status }));
      }
      if (!resource) {
        return Promise.resolve(Response.json({ error: { message: "Not Found" } }, { status: 404 }));
      }
      return Promise.resolve(Response.json(resource));
    }));
  };

  beforeEach(() => {
    requestedIds.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for exactly the named ids and omits the one the calendar no longer has", async () => {
    installDoubles(200);

    const remoteEvents = await asNamedLookup(createProvider()).getRemoteEventsByIds([
      "google-event-1",
      "google-event-missing",
      "google-event-2",
    ]);

    expect(requestedIds.toSorted()).toEqual([
      "google-event-1",
      "google-event-2",
      "google-event-missing",
    ]);
    expect(remoteEvents.map((event) => event.deleteId).toSorted()).toEqual([
      "google-event-1",
      "google-event-2",
    ]);
    expect(remoteEvents.map((event) => event.uid).toSorted()).toEqual(
      [PRESENT_UID_ONE, PRESENT_UID_TWO].toSorted(),
    );
  });

  it("rejects when the lookup request fails instead of reporting the events absent", async () => {
    installDoubles(500);

    await expect(
      asNamedLookup(createProvider()).getRemoteEventsByIds(["google-event-1", "google-event-2"]),
    ).rejects.toThrow();
  });
});

describe("outlook destination named event lookup", () => {
  const requestedIds: string[] = [];

  const outlookResource = (eventId: string, uid: string) => ({
    body: { content: "", contentType: "text" },
    categories: [KEEPER_CATEGORY],
    end: { dateTime: "2026-03-15T10:00:00.0000000", timeZone: "UTC" },
    iCalUId: uid,
    id: eventId,
    isAllDay: false,
    showAs: "busy",
    start: { dateTime: "2026-03-15T09:00:00.0000000", timeZone: "UTC" },
    subject: "Meeting",
  });

  const resourcesById = new Map([
    ["outlook-event-1", outlookResource("outlook-event-1", PRESENT_UID_ONE)],
    ["outlook-event-2", outlookResource("outlook-event-2", PRESENT_UID_TWO)],
  ]);

  const createProvider = () => createOutlookSyncProvider({
    accessToken: "test-token",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    calendarId: "cal-1",
    externalCalendarId: "external-cal-1",
    refreshToken: "test-refresh",
    userId: "user-1",
  });

  const installFetchDouble = (status: number): void => {
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input));
      const eventId = lastPathSegment(url.pathname);
      requestedIds.push(eventId);
      const resource = resourcesById.get(eventId);
      if (status !== 200) {
        return Promise.resolve(Response.json(
          { error: { code: "InternalServerError", message: "backend error" } },
          { status },
        ));
      }
      if (!resource) {
        return Promise.resolve(Response.json(
          { error: { code: "ErrorItemNotFound", message: "Not Found" } },
          { status: 404 },
        ));
      }
      return Promise.resolve(Response.json(resource));
    }));
  };

  beforeEach(() => {
    requestedIds.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for exactly the named ids and omits the one the calendar no longer has", async () => {
    installFetchDouble(200);

    const remoteEvents = await asNamedLookup(createProvider()).getRemoteEventsByIds([
      "outlook-event-1",
      "outlook-event-missing",
      "outlook-event-2",
    ]);

    expect(requestedIds.toSorted()).toEqual([
      "outlook-event-1",
      "outlook-event-2",
      "outlook-event-missing",
    ]);
    expect(remoteEvents.map((event) => event.deleteId).toSorted()).toEqual([
      "outlook-event-1",
      "outlook-event-2",
    ]);
    expect(remoteEvents.map((event) => event.uid).toSorted()).toEqual(
      [PRESENT_UID_ONE, PRESENT_UID_TWO].toSorted(),
    );
  });

  it("rejects when the lookup request fails instead of reporting the events absent", async () => {
    installFetchDouble(500);

    await expect(
      asNamedLookup(createProvider()).getRemoteEventsByIds(["outlook-event-1", "outlook-event-2"]),
    ).rejects.toThrow();
  });
});

describe("caldav destination named event lookup", () => {
  const CALENDAR_URL = "https://caldav.example.com/calendar/";
  const requestedFilenames: string[] = [];

  const objectsByFilename = new Map([
    [
      `${PRESENT_UID_ONE}.ics`,
      {
        data: eventToICalString(createCalDAVEvent("event-state-id-1"), PRESENT_UID_ONE),
        etag: "etag-1",
        url: `${CALENDAR_URL}${PRESENT_UID_ONE}.ics`,
      },
    ],
    [
      `${PRESENT_UID_TWO}.ics`,
      {
        data: eventToICalString(createCalDAVEvent("event-state-id-2"), PRESENT_UID_TWO),
        etag: "etag-2",
        url: `${CALENDAR_URL}${PRESENT_UID_TWO}.ics`,
      },
    ],
  ]);

  const createProvider = () => createCalDAVSyncProvider({
    calendarUrl: CALENDAR_URL,
    password: "pass",
    serverUrl: "https://caldav.example.com",
    username: "user",
  });

  const recordAndResolve = (filename: string) => {
    requestedFilenames.push(filename);
    return objectsByFilename.get(filename) ?? null;
  };

  const installClientDoubles = (fails: boolean): void => {
    caldavClientMocks.resolveCalendarUrl.mockResolvedValue(CALENDAR_URL);

    if (fails) {
      caldavClientMocks.fetchCalendarObjectsByUrls.mockRejectedValue(new Error("multiget failed"));
      caldavClientMocks.fetchCalendarObject.mockRejectedValue(new Error("GET failed"));
      return;
    }

    caldavClientMocks.fetchCalendarObjectsByUrls.mockImplementation(
      (params: { objectUrls: string[] }) =>
        Promise.resolve(params.objectUrls.flatMap((objectUrl) => {
          const object = recordAndResolve(lastPathSegment(new URL(objectUrl, CALENDAR_URL).pathname));
          if (!object) {
            return [];
          }
          return [object];
        })),
    );
    caldavClientMocks.fetchCalendarObject.mockImplementation((params: { filename: string }) =>
      Promise.resolve(recordAndResolve(params.filename)));
  };

  beforeEach(() => {
    requestedFilenames.length = 0;
    vi.clearAllMocks();
  });

  it("asks for exactly the named objects and omits the one the calendar no longer has", async () => {
    installClientDoubles(false);
    const missingUid = generateDeterministicEventUid("event-state-id-missing");

    const remoteEvents = await asNamedLookup(createProvider()).getRemoteEventsByIds([
      `/calendar/${PRESENT_UID_ONE}.ics`,
      `/calendar/${missingUid}.ics`,
      `/calendar/${PRESENT_UID_TWO}.ics`,
    ]);

    expect(caldavClientMocks.fetchCalendarObjects).not.toHaveBeenCalled();
    expect(requestedFilenames.toSorted()).toEqual(
      [`${PRESENT_UID_ONE}.ics`, `${PRESENT_UID_TWO}.ics`, `${missingUid}.ics`].toSorted(),
    );
    expect(remoteEvents.map((event) => event.uid).toSorted()).toEqual(
      [PRESENT_UID_ONE, PRESENT_UID_TWO].toSorted(),
    );
  });

  it("rejects when the lookup request fails instead of reporting the events absent", async () => {
    installClientDoubles(true);

    await expect(
      asNamedLookup(createProvider()).getRemoteEventsByIds([
        `/calendar/${PRESENT_UID_ONE}.ics`,
        `/calendar/${PRESENT_UID_TWO}.ics`,
      ]),
    ).rejects.toThrow();
  });
});
