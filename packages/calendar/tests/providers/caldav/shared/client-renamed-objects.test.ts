import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CalDAVClient } from "../../../../src/providers/caldav/shared/client";
import {
  createRenamingCalDAVServer,
  RENAMING_CALENDAR_PATH,
  RENAMING_CALENDAR_URL,
} from "./fake-renaming-caldav";
import type { RenamingCalDAVServer } from "./fake-renaming-caldav";

const icsFor = (uid: string): string =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    "DTSTART:20270308T160000Z",
    "DTEND:20270308T170000Z",
    "SUMMARY:Planning",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

const createClient = (): CalDAVClient =>
  new CalDAVClient({
    credentials: { password: "password", username: "someone" },
    serverUrl: RENAMING_CALENDAR_URL,
  });

let originalFetch: typeof globalThis.fetch = globalThis.fetch;
let server: RenamingCalDAVServer = createRenamingCalDAVServer();

beforeEach(() => {
  originalFetch = globalThis.fetch;
  server = createRenamingCalDAVServer();
  globalThis.fetch = server.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("reading a calendar whose object names do not end in .ics", () => {
  it("returns every event the calendar-query lists", async () => {
    const first = server.seed(icsFor("first@example.com"));
    const second = server.seed(icsFor("second@example.com"));

    const objects = await createClient().fetchCalendarObjects({
      calendarUrl: RENAMING_CALENDAR_URL,
      timeRange: { end: "2028-01-01T00:00:00.000Z", start: "2026-01-01T00:00:00.000Z" },
    });

    expect(objects.map(({ data, url }) => ({ data, path: new URL(url).pathname }))).toEqual([
      { data: icsFor("first@example.com"), path: `${RENAMING_CALENDAR_PATH}${encodeURIComponent(first)}` },
      { data: icsFor("second@example.com"), path: `${RENAMING_CALENDAR_PATH}${encodeURIComponent(second)}` },
    ]);
  });

  it("reads one object back by the href the server listed", async () => {
    const name = server.seed(icsFor("first@example.com"));
    const objectUrl = `${RENAMING_CALENDAR_URL}${encodeURIComponent(name)}`;

    const objects = await createClient().fetchCalendarObjectsByUrls({
      calendarUrl: RENAMING_CALENDAR_URL,
      objectUrls: [objectUrl],
    });

    expect(objects).toEqual([{ data: icsFor("first@example.com"), etag: "\"1\"", url: objectUrl }]);
  });
});
