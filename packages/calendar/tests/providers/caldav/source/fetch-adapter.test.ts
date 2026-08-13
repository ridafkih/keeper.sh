import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCalDAVSourceFetcher,
  isCalDAVEventInSyncWindow,
} from "../../../../src/providers/caldav/source/fetch-adapter";
import { createSourceIngestionPlan } from "../../../../src/core/sync/sync-range";

const davMocks = vi.hoisted(() => ({
  calendarQuery: vi.fn(),
  fetchCalendarObjects: vi.fn(),
  fetchCalendars: vi.fn(),
}));

vi.mock("tsdav", () => ({
  DAVNamespaceShort: { DAV: "d" },
  createDAVClient: () => Promise.resolve({
    calendarQuery: davMocks.calendarQuery,
    fetchCalendarObjects: davMocks.fetchCalendarObjects,
    fetchCalendars: davMocks.fetchCalendars,
  }),
}));

const SYNC_WINDOW = {
  timeMax: new Date("2026-06-01T00:00:00.000Z"),
  timeMin: new Date("2026-03-01T00:00:00.000Z"),
};

describe("isCalDAVEventInSyncWindow", () => {
  it("drops a non-recurring event that ends exactly at the window start", () => {
    expect(isCalDAVEventInSyncWindow({
      endTime: SYNC_WINDOW.timeMin,
      startTime: new Date("2026-02-28T23:00:00.000Z"),
    }, SYNC_WINDOW)).toBe(false);
  });

  it("drops a non-recurring event that starts exactly at the window end", () => {
    expect(isCalDAVEventInSyncWindow({
      endTime: new Date("2026-06-01T01:00:00.000Z"),
      startTime: SYNC_WINDOW.timeMax,
    }, SYNC_WINDOW)).toBe(false);
  });

  it("keeps a non-recurring event overlapping either boundary by a moment", () => {
    expect(isCalDAVEventInSyncWindow({
      endTime: new Date("2026-03-01T00:00:00.001Z"),
      startTime: new Date("2026-02-28T23:00:00.000Z"),
    }, SYNC_WINDOW)).toBe(true);
    expect(isCalDAVEventInSyncWindow({
      endTime: new Date("2026-06-01T01:00:00.000Z"),
      startTime: new Date("2026-05-31T23:59:59.999Z"),
    }, SYNC_WINDOW)).toBe(true);
  });

  it("keeps an all-day event ending at midnight on the window start", () => {
    expect(isCalDAVEventInSyncWindow({
      endTime: new Date("2026-03-02T00:00:00.000Z"),
      startTime: new Date("2026-03-01T00:00:00.000Z"),
    }, SYNC_WINDOW)).toBe(true);
  });

  it("keeps a recurring master that lies entirely before the window", () => {
    expect(isCalDAVEventInSyncWindow({
      endTime: new Date("2020-01-01T01:00:00.000Z"),
      recurrenceRule: { frequency: "WEEKLY" },
      startTime: new Date("2020-01-01T00:00:00.000Z"),
    }, SYNC_WINDOW)).toBe(true);
  });
});

const SERVER_URL = "https://caldav.example.com";
const CALENDAR_PATH = "/cal/u/";
const KEEPER_EVENT_COUNT = 1000;
const NATIVE_UID = "native-event@example.com";
const NOW = new Date("2026-06-15T00:00:00.000Z");

const icsFor = (uid: string): string =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//keeper.sh//test//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    "DTSTAMP:20260601T000000Z",
    "DTSTART:20260620T090000Z",
    "DTEND:20260620T100000Z",
    "SUMMARY:Test event",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

const uidForPath = (path: string): string => {
  const index = Number(path.replaceAll(/\D/gu, ""));
  if (index === KEEPER_EVENT_COUNT) {
    return NATIVE_UID;
  }
  return `${String(index).padStart(4, "0")}@keeper.sh`;
};

const objectPaths = (count: number): string[] =>
  Array.from(
    { length: count },
    (_unused, index) => `${CALENDAR_PATH}event-${String(index).padStart(4, "0")}.ics`,
  );

let queriedPaths: string[] = [];

const answerQueryWith = (hrefs: string[]): void => {
  queriedPaths = hrefs;
  davMocks.calendarQuery.mockResolvedValue(hrefs.map((href) => ({ href })));
};

const answerMultigetWith = (
  respond: (objectUrls: string[]) => { data: string; url: string }[],
): void => {
  davMocks.fetchCalendarObjects.mockImplementation(({ objectUrls }: { objectUrls?: string[] }) =>
    Promise.resolve(respond(objectUrls ?? queriedPaths)));
};

const createFetcher = () =>
  createCalDAVSourceFetcher({
    calendarUrl: `${SERVER_URL}${CALENDAR_PATH}`,
    password: "pass",
    plan: createSourceIngestionPlan("1_month", "2_years", NOW),
    serverUrl: SERVER_URL,
    username: "user",
  });

describe("createCalDAVSourceFetcher against a capped multiget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    davMocks.fetchCalendars.mockResolvedValue([]);
  });

  it("returns a native event that falls beyond the server's multiget response cap", async () => {
    answerQueryWith(objectPaths(KEEPER_EVENT_COUNT + 1));
    answerMultigetWith((objectUrls) =>
      objectUrls.slice(0, KEEPER_EVENT_COUNT).map((path) => ({
        data: icsFor(uidForPath(path)),
        url: `${SERVER_URL}${path}`,
      })));

    const result = await createFetcher().fetchEvents();

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.uid).toBe(NATIVE_UID);
  });
});

const TRUNCATED_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//keeper.sh//test//EN",
  "BEGIN:VEVENT",
  "UID:truncated@example.com",
  "DTSTART:20260620T090000Z",
].join("\r\n");

const dataForNativeObject = (index: number): string => {
  if (index === 1) {
    return TRUNCATED_ICS;
  }
  return icsFor(`native-${index}@example.com`);
};

describe("createCalDAVSourceFetcher against an unreadable resource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    davMocks.fetchCalendars.mockResolvedValue([]);
  });

  it("ingests the readable resources and reports the skipped count", async () => {
    answerQueryWith(objectPaths(3));
    answerMultigetWith((objectUrls) =>
      objectUrls.map((path, index) => ({
        data: dataForNativeObject(index),
        url: `${SERVER_URL}${path}`,
      })));

    const result = await createFetcher().fetchEvents();

    expect(result.events.map(({ uid }) => uid))
      .toEqual(["native-0@example.com", "native-2@example.com"]);
    expect(result.skippedResourceCount).toBe(1);
    expect(result.skippedResourceReasons)
      .toEqual(["Malformed ICS component boundary: missing END:VEVENT"]);
  });
});
