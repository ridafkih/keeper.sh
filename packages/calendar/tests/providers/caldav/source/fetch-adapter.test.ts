import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCalDAVSourceFetcher,
  isCalDAVEventInSyncWindow,
} from "../../../../src/providers/caldav/source/fetch-adapter";
import { createSourceIngestionPlan } from "../../../../src/core/sync/sync-range";
import {
  CALENDAR_PATH,
  createCalDAVServerStub,
  SERVER_URL,
} from "../shared/caldav-server-stub";
import type { MultiGetRow } from "../shared/caldav-server-stub";

const fetchMocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
}));

vi.mock("../../../../src/utils/safe-fetch", () => ({
  createSafeFetch: () => fetchMocks.safeFetch,
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

const uidForHref = (href: string): string => {
  const index = Number(href.replaceAll(/\D/gu, ""));
  if (index === KEEPER_EVENT_COUNT) {
    return NATIVE_UID;
  }
  return `${String(index).padStart(4, "0")}@keeper.sh`;
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
  });

  /*
   * Regression for #461. Every object inside the server's 1,000-row response
   * cap is a Keeper-created event, so the single native event beyond the cap
   * was dropped and ingestion reported success with zero events added.
   */
  it("returns a native event that falls beyond the server's multiget response cap", async () => {
    const hrefs = Array.from(
      { length: KEEPER_EVENT_COUNT + 1 },
      (_unused, index) => `${CALENDAR_PATH}event-${String(index).padStart(4, "0")}.ics`,
    );
    const stub = createCalDAVServerStub({
      queryHrefs: hrefs,
      respond: (requested): MultiGetRow[] =>
        requested.slice(0, KEEPER_EVENT_COUNT).map((href) => ({
          data: icsFor(uidForHref(href)),
          href,
        })),
    });
    fetchMocks.safeFetch.mockImplementation(stub.handle);

    const result = await createFetcher().fetchEvents();

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.uid).toBe(NATIVE_UID);
  });

  it("returns the native event when the server honours the whole multiget", async () => {
    const hrefs = Array.from(
      { length: KEEPER_EVENT_COUNT + 1 },
      (_unused, index) => `${CALENDAR_PATH}event-${String(index).padStart(4, "0")}.ics`,
    );
    const stub = createCalDAVServerStub({
      queryHrefs: hrefs,
      respond: (requested): MultiGetRow[] =>
        requested.map((href) => ({ data: icsFor(uidForHref(href)), href })),
    });
    fetchMocks.safeFetch.mockImplementation(stub.handle);

    const result = await createFetcher().fetchEvents();

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.uid).toBe(NATIVE_UID);
  });
});
