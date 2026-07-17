import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPullRemoteCalendar } = vi.hoisted(() => ({
  mockPullRemoteCalendar: vi.fn<(...args: unknown[]) => Promise<{ ical: string }>>(),
}));
const { mockPrepareCalendarSnapshot } = vi.hoisted(() => ({
  mockPrepareCalendarSnapshot: vi.fn<(...args: unknown[]) => Promise<{
    changed: boolean;
    snapshot?: { contentHash: string; ical: string };
  }>>(),
}));

vi.mock("../../../src/ics/utils/pull-remote-calendar", () => ({
  pullRemoteCalendar: mockPullRemoteCalendar,
}));
vi.mock("../../../src/ics/utils/create-snapshot", () => ({
  prepareCalendarSnapshot: mockPrepareCalendarSnapshot,
}));

const MINIMAL_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//test//test//EN",
  "BEGIN:VEVENT",
  "UID:event-1@test",
  "DTSTAMP:20260517T000000Z",
  "DTSTART:20260517T120000Z",
  "DTEND:20260517T130000Z",
  "SUMMARY:Test",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const buildConfig = () => ({
  calendarId: "calendar-1",
  url: "https://example.com/calendar.ics",
  database: {} as never,
});

describe("createIcsSourceFetcher", () => {
  beforeEach(() => {
    mockPullRemoteCalendar.mockReset();
    mockPrepareCalendarSnapshot.mockReset();
  });

  it("propagates fetch errors instead of returning empty events", async () => {
    /*
     * Regression: previously this path returned {events: []}, which caused
     * ingestSource to delete every existing event_state on a transient hiccup.
     */
    const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");
    mockPullRemoteCalendar.mockRejectedValueOnce(new Error("network unreachable"));

    const fetcher = createIcsSourceFetcher(buildConfig());

    await expect(fetcher.fetchEvents()).rejects.toThrow("network unreachable");
    expect(mockPrepareCalendarSnapshot).not.toHaveBeenCalled();
  });

  it("returns parsed events on a successful changed fetch", async () => {
    const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");
    mockPullRemoteCalendar.mockResolvedValueOnce({ ical: MINIMAL_ICS });
    mockPrepareCalendarSnapshot.mockResolvedValueOnce({
      changed: true,
      snapshot: { contentHash: "hash-1", ical: MINIMAL_ICS },
    });

    const fetcher = createIcsSourceFetcher(buildConfig());
    const result = await fetcher.fetchEvents();

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.uid).toBe("event-1@test");
    expect(result.snapshot).toEqual({ contentHash: "hash-1", ical: MINIMAL_ICS });
    expect(result.unchanged).toBeUndefined();
  });

  it("passes calendar timezone metadata to event interpretation", async () => {
    const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");
    mockPullRemoteCalendar.mockResolvedValueOnce({
      ical: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//test//test//EN",
        "X-WR-TIMEZONE:America/Toronto",
        "BEGIN:VEVENT",
        "UID:event-1@test",
        "DTSTAMP:20260630T000000Z",
        "DTSTART:20260630T040000Z",
        "DTEND:20260701T040000Z",
        "SUMMARY:Busy",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    });
    mockPrepareCalendarSnapshot.mockResolvedValueOnce({
      changed: true,
      snapshot: { contentHash: "hash-2", ical: MINIMAL_ICS },
    });

    const fetcher = createIcsSourceFetcher(buildConfig());
    let calendarTimeZone: string | null = null;
    const result = await fetcher.fetchEvents({
      interpretEvents: (events, { calendarTimeZone: parsedCalendarTimeZone }) => {
        calendarTimeZone = parsedCalendarTimeZone ?? null;
        return events;
      },
    });

    expect(result.events).toHaveLength(1);
    expect(calendarTimeZone).toBe("America/Toronto");
  });

  it("returns unchanged when snapshot content has not changed", async () => {
    const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");
    mockPullRemoteCalendar.mockResolvedValueOnce({ ical: MINIMAL_ICS });
    mockPrepareCalendarSnapshot.mockResolvedValueOnce({ changed: false });

    const fetcher = createIcsSourceFetcher(buildConfig());
    const result = await fetcher.fetchEvents();

    expect(result.events).toEqual([]);
    expect(result.unchanged).toBe(true);
  });
});
