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
  plan: {
    futureRange: "2_years" as const,
    historicRange: "1_week" as const,
    window: {
      timeMin: new Date("2026-01-01T00:00:00.000Z"),
      timeMax: new Date("2027-01-01T00:00:00.000Z"),
    },
  },
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

  it("reports the RDATE event as unsupported instead of failing the whole feed", async () => {
    const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");
    const rdateIcs = MINIMAL_ICS.replace(
      "END:VCALENDAR",
      [
        "BEGIN:VEVENT",
        "UID:rdate@test",
        "DTSTAMP:20260517T000000Z",
        "DTSTART:20260518T120000Z",
        "DTEND:20260518T130000Z",
        "RDATE:20260519T120000Z",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    );
    mockPullRemoteCalendar.mockResolvedValueOnce({ ical: rdateIcs });
    mockPrepareCalendarSnapshot.mockResolvedValueOnce({ changed: false });

    const result = await createIcsSourceFetcher(buildConfig()).fetchEvents();

    expect(result.events.map(({ uid }) => uid)).toEqual(["event-1@test", "rdate@test"]);
    expect(result.unsupportedEventUids).toEqual(["rdate@test"]);
    expect(mockPrepareCalendarSnapshot).toHaveBeenCalled();
  });

  it("still rejects a malformed component boundary that could hide an RDATE", async () => {
    const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");
    const malformedIcs = MINIMAL_ICS.replace("END:VEVENT", "END:VALARM");
    mockPullRemoteCalendar.mockResolvedValueOnce({ ical: malformedIcs });

    await expect(createIcsSourceFetcher(buildConfig()).fetchEvents())
      .rejects.toThrow("expected END:VEVENT, received END:VALARM");
    expect(mockPrepareCalendarSnapshot).not.toHaveBeenCalled();
  });

  it("resolves an unrecognised fixed-offset TZID from its declared VTIMEZONE", async () => {
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
    mockPrepareCalendarSnapshot.mockResolvedValueOnce({ changed: false });

    const result = await createIcsSourceFetcher(buildConfig()).fetchEvents();

    expect(result.events[0]).toMatchObject({
      startTime: new Date("2026-07-01T14:00:00.000Z"),
      startTimeZone: "Etc/GMT+5",
    });
    expect(result.unsupportedEventUids).toBeUndefined();
  });

  it("resolves a tzurl-style TZID to the IANA zone it carries", async () => {
    const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");
    const mozillaIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//test//EN",
      "BEGIN:VTIMEZONE",
      "TZID:/mozilla.org/20050126_1/America/Denver",
      "BEGIN:STANDARD",
      "DTSTART:19701101T020000",
      "TZOFFSETFROM:-0600",
      "TZOFFSETTO:-0700",
      "END:STANDARD",
      "BEGIN:DAYLIGHT",
      "DTSTART:19700308T020000",
      "TZOFFSETFROM:-0700",
      "TZOFFSETTO:-0600",
      "END:DAYLIGHT",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:thunderbird@test",
      "DTSTART;TZID=/mozilla.org/20050126_1/America/Denver:20260701T090000",
      "DTEND;TZID=/mozilla.org/20050126_1/America/Denver:20260701T100000",
      "RRULE:FREQ=DAILY;COUNT=2",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    mockPullRemoteCalendar.mockResolvedValueOnce({ ical: mozillaIcs });
    mockPrepareCalendarSnapshot.mockResolvedValueOnce({ changed: false });

    const result = await createIcsSourceFetcher(buildConfig()).fetchEvents();

    expect(result.events[0]?.startTimeZone).toBe("America/Denver");
    expect(result.unsupportedEventUids).toBeUndefined();
  });

  it("reports a recurring event whose timezone cannot be recovered without failing the feed", async () => {
    const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");
    const exchangeIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//test//EN",
      "BEGIN:VTIMEZONE",
      "TZID:Customized Time Zone",
      "BEGIN:STANDARD",
      "DTSTART:19701101T020000",
      "TZOFFSETFROM:-0600",
      "TZOFFSETTO:-0700",
      "END:STANDARD",
      "BEGIN:DAYLIGHT",
      "DTSTART:19700308T020000",
      "TZOFFSETFROM:-0700",
      "TZOFFSETTO:-0600",
      "END:DAYLIGHT",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:exchange-custom@test",
      "DTSTART;TZID=Customized Time Zone:20260701T090000",
      "DTEND;TZID=Customized Time Zone:20260701T100000",
      "RRULE:FREQ=DAILY;COUNT=2",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:healthy@test",
      "DTSTAMP:20260517T000000Z",
      "DTSTART:20260517T120000Z",
      "DTEND:20260517T130000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    mockPullRemoteCalendar.mockResolvedValueOnce({ ical: exchangeIcs });
    mockPrepareCalendarSnapshot.mockResolvedValueOnce({ changed: false });

    const result = await createIcsSourceFetcher(buildConfig()).fetchEvents();

    expect(result.events.map(({ uid }) => uid)).toEqual([
      "exchange-custom@test",
      "healthy@test",
    ]);
    expect(result.unsupportedEventUids).toEqual(["exchange-custom@test"]);
  });

  it("resolves a floating RRULE UNTIL against the event's own DTSTART timezone", async () => {
    const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");
    const zonedIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//test//EN",
      "BEGIN:VEVENT",
      "UID:zoned-until@test",
      "DTSTAMP:20260101T000000Z",
      "DTSTART;TZID=America/Denver:20260105T090000",
      "DTEND;TZID=America/Denver:20260105T100000",
      "RRULE:FREQ=DAILY;UNTIL=20260112T090000",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    mockPullRemoteCalendar.mockResolvedValueOnce({ ical: zonedIcs });
    mockPrepareCalendarSnapshot.mockResolvedValueOnce({ changed: false });

    const result = await createIcsSourceFetcher(buildConfig()).fetchEvents();

    expect(result.events[0]?.recurrenceRule?.until?.date).toEqual(
      new Date("2026-01-12T16:00:00.000Z"),
    );
  });

  it("resolves a floating EXDATE against the event's own DTSTART timezone", async () => {
    const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");
    const zonedIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//test//EN",
      "BEGIN:VEVENT",
      "UID:zoned-exdate@test",
      "DTSTAMP:20260101T000000Z",
      "DTSTART;TZID=America/Denver:20260105T090000",
      "DTEND;TZID=America/Denver:20260105T100000",
      "RRULE:FREQ=DAILY;COUNT=5",
      "EXDATE:20260106T090000",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    mockPullRemoteCalendar.mockResolvedValueOnce({ ical: zonedIcs });
    mockPrepareCalendarSnapshot.mockResolvedValueOnce({ changed: false });

    const result = await createIcsSourceFetcher(buildConfig()).fetchEvents();

    expect(result.events[0]?.exceptionDates?.map(({ date }) => date)).toEqual([
      new Date("2026-01-06T16:00:00.000Z"),
    ]);
  });

  it("resolves only the floating entries of a mixed multi-value EXDATE", async () => {
    const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");
    const zonedIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//test//EN",
      "BEGIN:VEVENT",
      "UID:mixed-exdate@test",
      "DTSTAMP:20260101T000000Z",
      "DTSTART;TZID=America/Denver:20260105T090000",
      "DTEND;TZID=America/Denver:20260105T100000",
      "RRULE:FREQ=DAILY;COUNT=5",
      "EXDATE:20260106T090000,20260107T160000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    mockPullRemoteCalendar.mockResolvedValueOnce({ ical: zonedIcs });
    mockPrepareCalendarSnapshot.mockResolvedValueOnce({ changed: false });

    const result = await createIcsSourceFetcher(buildConfig()).fetchEvents();

    expect(result.events[0]?.exceptionDates?.map(({ date }) => date)).toEqual([
      new Date("2026-01-06T16:00:00.000Z"),
      new Date("2026-01-07T16:00:00.000Z"),
    ]);
  });

  it("resolves a floating RECURRENCE-ID against the event's own DTSTART timezone", async () => {
    const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");
    const zonedIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//test//EN",
      "BEGIN:VEVENT",
      "UID:zoned-override@test",
      "DTSTAMP:20260101T000000Z",
      "DTSTART;TZID=America/Denver:20260105T090000",
      "DTEND;TZID=America/Denver:20260105T100000",
      "RRULE:FREQ=DAILY;COUNT=5",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:zoned-override@test",
      "DTSTAMP:20260101T000000Z",
      "RECURRENCE-ID:20260106T090000",
      "DTSTART;TZID=America/Denver:20260106T110000",
      "DTEND;TZID=America/Denver:20260106T120000",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    mockPullRemoteCalendar.mockResolvedValueOnce({ ical: zonedIcs });
    mockPrepareCalendarSnapshot.mockResolvedValueOnce({ changed: false });

    const result = await createIcsSourceFetcher(buildConfig()).fetchEvents();

    expect(result.events.find(({ recurrenceId }) => recurrenceId)?.recurrenceId).toEqual(
      new Date("2026-01-06T16:00:00.000Z"),
    );
  });

  it("leaves an all-day series with a date-time UNTIL alone", async () => {
    const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");
    const allDayIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//test//EN",
      "BEGIN:VEVENT",
      "UID:all-day-series@test",
      "DTSTAMP:20260101T000000Z",
      "DTSTART;VALUE=DATE:20260105",
      "DTEND;VALUE=DATE:20260106",
      "RRULE:FREQ=WEEKLY;UNTIL=20260112T090000",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    mockPullRemoteCalendar.mockResolvedValueOnce({ ical: allDayIcs });
    mockPrepareCalendarSnapshot.mockResolvedValueOnce({ changed: false });

    const result = await createIcsSourceFetcher(buildConfig()).fetchEvents();

    expect(result.events[0]).toMatchObject({
      isAllDay: true,
      uid: "all-day-series@test",
    });
    expect(result.events[0]?.recurrenceRule?.until?.date).toEqual(
      new Date("2026-01-12T09:00:00.000Z"),
    );
  });

  it("rejects a floating EXDATE when no event or calendar timezone exists", async () => {
    const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");
    const ambiguousIcs = MINIMAL_ICS.replace(
      "SUMMARY:Test",
      "RRULE:FREQ=DAILY;COUNT=3\r\nEXDATE:20260518T120000\r\nSUMMARY:Test",
    );
    mockPullRemoteCalendar.mockResolvedValueOnce({ ical: ambiguousIcs });
    mockPrepareCalendarSnapshot.mockResolvedValueOnce({ changed: false });

    await expect(createIcsSourceFetcher(buildConfig()).fetchEvents())
      .rejects.toThrow("Floating ICS EXDATE requires an explicit TZID or X-WR-TIMEZONE");
  });

  it("returns events far outside the sync window so stored history stays unbounded", async () => {
    /*
     * ICS storage is unbounded on purpose: the sync window bounds what Keeper
     * mirrors to destinations, not what it retains. Dropping historic events here
     * would make the snapshot diff delete their stored state on the next ingest.
     */
    const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");
    const historicIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//test//EN",
      "BEGIN:VEVENT",
      "UID:ancient@test",
      "DTSTAMP:20190517T000000Z",
      "DTSTART:20190517T120000Z",
      "DTEND:20190517T130000Z",
      "SUMMARY:Ancient",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:distant-future@test",
      "DTSTAMP:20190517T000000Z",
      "DTSTART:20400517T120000Z",
      "DTEND:20400517T130000Z",
      "SUMMARY:Distant",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:event-1@test",
      "DTSTAMP:20260517T000000Z",
      "DTSTART:20260517T120000Z",
      "DTEND:20260517T130000Z",
      "SUMMARY:Test",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    mockPullRemoteCalendar.mockResolvedValueOnce({ ical: historicIcs });
    mockPrepareCalendarSnapshot.mockResolvedValueOnce({
      changed: true,
      snapshot: { contentHash: "historic", ical: historicIcs },
    });

    const result = await createIcsSourceFetcher(buildConfig()).fetchEvents();

    expect(result.events.map(({ uid }) => uid)).toEqual([
      "ancient@test",
      "distant-future@test",
      "event-1@test",
    ]);
  });
});
