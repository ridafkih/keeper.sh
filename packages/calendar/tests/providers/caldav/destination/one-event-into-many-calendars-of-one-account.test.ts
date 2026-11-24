import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateCalendarScopedEventUid,
  generateDeterministicEventUid,
} from "../../../../src/core/events/identity";
import type { MaterializedSyncableEvent } from "../../../../src/core/types";
import { createCalDAVSyncProvider } from "../../../../src/providers/caldav/destination/provider";
import { readCalendarObjectUids } from "../../../../src/providers/caldav/shared/ics";

const account = vi.hoisted(() => ({
  objects: new Map<string, { calendarUrl: string; data: string }>(),
  uidOwners: new Map<string, string>(),
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

  const claimUids = (calendarUrl: string, data: string): void => {
    for (const uid of readCalendarObjectUids(data)) {
      const owner = account.uidOwners.get(uid);
      if (owner && owner !== calendarUrl) {
        throw new MockCalDAVCreateConflictError(new Response(null, { status: 412 }));
      }
    }
    for (const uid of readCalendarObjectUids(data)) {
      account.uidOwners.set(uid, calendarUrl);
    }
  };

  const createCalendarObject = (params: { calendarUrl: string; filename: string; iCalString: string }) => {
    claimUids(params.calendarUrl, params.iCalString);
    account.objects.set(`${params.calendarUrl}${params.filename}`, {
      calendarUrl: params.calendarUrl,
      data: params.iCalString,
    });
    return Promise.resolve();
  };

  const fetchCalendarObject = (params: { calendarUrl: string; filename: string }) => {
    const object = account.objects.get(`${params.calendarUrl}${params.filename}`);
    if (!object) {
      return Promise.resolve(null);
    }
    return Promise.resolve({ data: object.data, etag: "\"1\"", url: params.filename });
  };

  const updateCalendarObjectByUrl = (params: { iCalString: string; objectUrl: string }) => {
    const calendarUrl = params.objectUrl.slice(0, params.objectUrl.lastIndexOf("/") + 1);
    claimUids(calendarUrl, params.iCalString);
    account.objects.set(params.objectUrl, { calendarUrl, data: params.iCalString });
    return Promise.resolve();
  };

  class CalDAVClient {
    createCalendarObject = createCalendarObject;
    fetchCalendarObject = fetchCalendarObject;
    updateCalendarObjectByUrl = updateCalendarObjectByUrl;
  }

  return {
    CalDAVClient,
    CalDAVCreateConflictError: MockCalDAVCreateConflictError,
    CalDAVHttpError: MockCalDAVHttpError,
  };
});

const ACCOUNT_SERVER_URL = "https://caldav.example.com/";

const calendars = [
  { id: "destination-calendar-work", url: "https://caldav.example.com/123/calendars/work/" },
  { id: "destination-calendar-home", url: "https://caldav.example.com/123/calendars/home/" },
  { id: "destination-calendar-family", url: "https://caldav.example.com/123/calendars/family/" },
];

const event: MaterializedSyncableEvent = {
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-03-08T15:00:00.000Z"),
  id: "event-state-id-1",
  sourceEventUid: "source-event-uid-1",
  startTime: new Date("2026-03-08T14:00:00.000Z"),
  summary: "Standup",
};

const createProvider = (calendar: { id: string; url: string }) =>
  createCalDAVSyncProvider({
    authMethod: "basic",
    calendarUrl: calendar.url,
    destinationCalendarId: calendar.id,
    password: "password",
    serverUrl: ACCOUNT_SERVER_URL,
    username: "user",
  });

beforeEach(() => {
  account.objects.clear();
  account.uidOwners.clear();
});

describe("one source event mirrored into several calendars of one account", () => {
  it("writes every calendar even when the server holds each UID to one calendar per account", async () => {
    const results = await Promise.all(calendars.map((calendar) => createProvider(calendar).pushEvents([event])));

    expect(results.flat().map((result) => result.success)).toEqual([true, true, true]);
    expect(new Set(results.flat().map((result) => result.remoteId)).size).toBe(calendars.length);
  });

  it("gives each destination calendar a UID of its own for the same event", () => {
    const [work, home] = calendars;
    if (!work || !home) {
      throw new Error("fixture calendars missing");
    }

    expect(generateCalendarScopedEventUid(event.id, work.id))
      .not.toBe(generateCalendarScopedEventUid(event.id, home.id));
  });

  it("keeps updating an object first written under the event's unscoped UID", async () => {
    const [work] = calendars;
    if (!work) {
      throw new Error("fixture calendars missing");
    }
    const legacyUid = generateDeterministicEventUid(event.id);

    const [result] = await createProvider(work).updateEvents?.([{
      deleteId: legacyUid,
      event: { ...event, summary: "Standup moved" },
    }]) ?? [];

    expect(result).toMatchObject({ remoteId: legacyUid, success: true });
    const written = account.objects.get(`${work.url}${legacyUid}.ics`);
    expect(written && readCalendarObjectUids(written.data)).toEqual([legacyUid]);
  });

  it("updates an object written under the calendar-scoped UID in place", async () => {
    const [work] = calendars;
    if (!work) {
      throw new Error("fixture calendars missing");
    }
    const provider = createProvider(work);
    const [pushed] = await provider.pushEvents([event]);
    const scopedUid = generateCalendarScopedEventUid(event.id, work.id);

    const [result] = await provider.updateEvents?.([{
      deleteId: pushed?.deleteId ?? "",
      event: { ...event, summary: "Standup moved" },
    }]) ?? [];

    expect(result).toMatchObject({ remoteId: scopedUid, success: true });
  });
});
