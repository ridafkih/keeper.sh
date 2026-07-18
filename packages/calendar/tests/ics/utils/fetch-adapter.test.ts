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

  it("interprets floating event times using X-WR-TIMEZONE", async () => {
    const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");
    const floatingIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//test//EN",
      "X-WR-TIMEZONE:America/Edmonton",
      "BEGIN:VEVENT",
      "UID:floating-event@test",
      "DTSTART:20260310T090000",
      "DTEND:20260310T100000",
      "RRULE:FREQ=WEEKLY;COUNT=2",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    mockPullRemoteCalendar.mockResolvedValueOnce({ ical: floatingIcs });
    mockPrepareCalendarSnapshot.mockResolvedValueOnce({
      changed: true,
      snapshot: { contentHash: "hash-floating", ical: floatingIcs },
    });

    const result = await createIcsSourceFetcher(buildConfig()).fetchEvents();

    expect(result.events[0]).toMatchObject({
      startTime: new Date("2026-03-10T15:00:00.000Z"),
      startTimeZone: "America/Edmonton",
    });
  });

  it("interprets floating RRULE UNTIL in the calendar timezone", async () => {
    const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");
    const floatingIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//test//EN",
      "X-WR-TIMEZONE:America/New_York",
      "BEGIN:VEVENT",
      "UID:floating-until@test",
      "DTSTART:20260301T090000",
      "DTEND:20260301T100000",
      "RRULE:FREQ=DAILY;UNTIL=20260303T090000",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    mockPullRemoteCalendar.mockResolvedValueOnce({ ical: floatingIcs });
    mockPrepareCalendarSnapshot.mockResolvedValueOnce({ changed: false });

    const result = await createIcsSourceFetcher(buildConfig()).fetchEvents();

    expect(result.events[0]?.recurrenceRule?.until?.date).toEqual(
      new Date("2026-03-03T14:00:00.000Z"),
    );
  });

  it("rejects floating RRULE UNTIL without calendar timezone context", async () => {
    const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");
    const floatingIcs = MINIMAL_ICS.replace(
      "SUMMARY:Test",
      "RRULE:FREQ=DAILY;UNTIL=20260519T120000\r\nSUMMARY:Test",
    );
    mockPullRemoteCalendar.mockResolvedValueOnce({ ical: floatingIcs });
    mockPrepareCalendarSnapshot.mockResolvedValueOnce({ changed: false });

    await expect(createIcsSourceFetcher(buildConfig()).fetchEvents())
      .rejects.toThrow("Floating ICS RRULE UNTIL requires an explicit X-WR-TIMEZONE");
  });

  it("treats VALUE=DATE-TIME as floating rather than all-day", async () => {
    const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");
    const floatingIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//test//EN",
      "X-WR-TIMEZONE:America/Edmonton",
      "BEGIN:VEVENT",
      "UID:explicit-date-time@test",
      "DTSTART;VALUE=DATE-TIME:20260310T090000",
      "DTEND;VALUE=DATE-TIME:20260310T100000",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    mockPullRemoteCalendar.mockResolvedValueOnce({ ical: floatingIcs });
    mockPrepareCalendarSnapshot.mockResolvedValueOnce({
      changed: true,
      snapshot: { contentHash: "hash-date-time", ical: floatingIcs },
    });

    const result = await createIcsSourceFetcher(buildConfig()).fetchEvents();

    expect(result.events[0]?.startTime).toEqual(new Date("2026-03-10T15:00:00.000Z"));
  });

  it("rejects floating event times without calendar timezone context", async () => {
    const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");
    const floatingIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//test//EN",
      "BEGIN:VEVENT",
      "UID:ambiguous-floating-event@test",
      "DTSTART:20260310T090000",
      "DTEND:20260310T100000",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    mockPullRemoteCalendar.mockResolvedValueOnce({ ical: floatingIcs });
    mockPrepareCalendarSnapshot.mockResolvedValueOnce({
      changed: true,
      snapshot: { contentHash: "hash-ambiguous", ical: floatingIcs },
    });

    await expect(createIcsSourceFetcher(buildConfig()).fetchEvents())
      .rejects.toThrow("Floating ICS DTSTART requires an explicit TZID or X-WR-TIMEZONE");
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

  it("reparses unchanged snapshot content so stored-state validation can recover", async () => {
    const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");
    mockPullRemoteCalendar.mockResolvedValueOnce({ ical: MINIMAL_ICS });
    mockPrepareCalendarSnapshot.mockResolvedValueOnce({ changed: false });

    const fetcher = createIcsSourceFetcher(buildConfig());
    const result = await fetcher.fetchEvents();

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.uid).toBe("event-1@test");
    expect(result.snapshot).toBeUndefined();
    expect(result.unchanged).toBeUndefined();
  });

  it("rejects RDATE instead of silently dropping additional occurrences", async () => {
    const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");
    const rdateIcs = MINIMAL_ICS.replace(
      "DTEND:20260517T130000Z",
      "DTEND:20260517T130000Z\r\nRDATE:20260519T120000Z",
    );
    mockPullRemoteCalendar.mockResolvedValueOnce({ ical: rdateIcs });

    await expect(createIcsSourceFetcher(buildConfig()).fetchEvents())
      .rejects.toThrow("ICS RDATE recurrence is not supported");
    expect(mockPrepareCalendarSnapshot).not.toHaveBeenCalled();
  });

  it("rejects custom-timezone recurrence before it can poison destination sync", async () => {
    const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");
    const customTimezoneIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//test//EN",
      "BEGIN:VTIMEZONE",
      "TZID:Custom/Eastern",
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      "TZOFFSETFROM:-0500",
      "TZOFFSETTO:-0500",
      "END:STANDARD",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:custom-timezone@test",
      "DTSTART;TZID=Custom/Eastern:20260701T090000",
      "DTEND;TZID=Custom/Eastern:20260701T100000",
      "RRULE:FREQ=DAILY;COUNT=2",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    mockPullRemoteCalendar.mockResolvedValueOnce({ ical: customTimezoneIcs });
    mockPrepareCalendarSnapshot.mockResolvedValueOnce({
      changed: true,
      snapshot: { contentHash: "custom-timezone", ical: customTimezoneIcs },
    });

    await expect(createIcsSourceFetcher(buildConfig()).fetchEvents())
      .rejects.toThrow("Unsupported calendar timezone: Custom/Eastern");
  });
});
