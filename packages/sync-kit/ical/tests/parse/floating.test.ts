import { describe, expect, test } from "vitest";
import { applyIcsPatches, projectIcsFeed } from "../../src/index";
import { calendarWith, testScope, vevent } from "../support/feed";
import { testLimits, testOptions } from "../support/options";
import { defaultIcsPatches } from "../../src/index";

const berlinVtimezone = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Berlin",
  "BEGIN:STANDARD",
  "DTSTART:19701025T030000",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:19700329T020000",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
] as const;

const mixedExdateEvent = vevent({
  uid: "evt-mixed-exdate",
  lines: [
    "DTSTAMP:20260301T080000Z",
    "DTSTART;TZID=Europe/Berlin:20260302T090000",
    "DTEND;TZID=Europe/Berlin:20260302T100000",
    "RRULE:FREQ=WEEKLY;COUNT=8",
    "EXDATE:20260309T090000,20260316T080000Z",
    "SUMMARY:mixed exceptions",
  ],
});

const project = (body: string) =>
  projectIcsFeed({ body, scope: testScope, previousContentHash: null, options: testOptions() });

describe("floating values", () => {
  test("ICAL-O32: only the floating entries of a mixed multi-value EXDATE are resolved", () => {
    const projection = project(calendarWith([...berlinVtimezone, ...mixedExdateEvent]));

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    const [event] = projection.value.listing.events;
    expect(event).toBeDefined();
    if (!event) {
      return;
    }
    expect(event.content.recurrence?.exceptions).toEqual([
      "20260309T080000Z",
      "20260316T080000Z",
    ]);
  });

  test("ICAL-O32: the mixed property is split across two lines rather than rewritten as one", () => {
    const patched = applyIcsPatches(
      calendarWith([...berlinVtimezone, ...mixedExdateEvent]),
      defaultIcsPatches,
      testLimits(),
    );

    expect(patched.kind).toBe("patched");
    if (patched.kind !== "patched") {
      return;
    }
    const exdateLines = patched.text
      .split("\r\n")
      .filter((line) => line.startsWith("EXDATE"));
    expect(exdateLines).toHaveLength(2);
    expect(exdateLines).toContain("EXDATE:20260316T080000Z");
  });

  test("ICAL-O33: a floating EXDATE with no zone context is unsupported, not guessed", () => {
    const noZoneContext = vevent({
      uid: "evt-floating-exdate",
      lines: [
        "DTSTAMP:20260301T080000Z",
        "DTSTART:20260302T090000Z",
        "DTEND:20260302T100000Z",
        "RRULE:FREQ=WEEKLY;COUNT=8",
        "EXDATE:20260309T090000",
        "SUMMARY:floating exception",
      ],
    });
    const projection = project(calendarWith([...noZoneContext]));

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.unsupported).toEqual([
      expect.objectContaining({ reason: "unresolvableTimeZone" }),
    ]);
    expect(projection.value.usable).toEqual([]);
  });

  test("ICAL-O34: a TZID-qualified value ignores a contradicting X-WR-TIMEZONE", () => {
    const body = calendarWith([
      "X-WR-TIMEZONE:America/New_York",
      ...berlinVtimezone,
      ...vevent({
        uid: "evt-qualified",
        lines: [
          "DTSTAMP:20260301T080000Z",
          "DTSTART;TZID=Europe/Berlin:20260302T090000",
          "DTEND;TZID=Europe/Berlin:20260302T100000",
          "SUMMARY:qualified",
        ],
      }),
    ]);
    const projection = project(body);

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    const [event] = projection.value.listing.events;
    expect(event).toBeDefined();
    if (!event || !event.content.time) {
      return;
    }
    expect(event.content.time.kind).toBe("timed");
    if (event.content.time.kind !== "timed") {
      return;
    }
    expect(event.content.time.start.value).toBe("2026-03-02T08:00:00.000Z");
  });

  test("ICAL-I28: X-WR-TIMEZONE anchors a genuinely floating value when the event states no TZID", () => {
    const body = calendarWith([
      "X-WR-TIMEZONE:America/New_York",
      ...vevent({
        uid: "evt-floating",
        lines: [
          "DTSTAMP:20260301T080000Z",
          "DTSTART:20260302T090000",
          "DTEND:20260302T100000",
          "SUMMARY:floating",
        ],
      }),
    ]);
    const projection = project(body);

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    const [event] = projection.value.listing.events;
    expect(event).toBeDefined();
    if (!event || !event.content.time) {
      return;
    }
    if (event.content.time.kind !== "timed") {
      return;
    }
    expect(event.content.time.start.value).toBe("2026-03-02T14:00:00.000Z");
  });

  test("ICAL-I28: floating anchoring is isolated per VEVENT, so one event's TZID never leaks to the next", () => {
    const body = calendarWith([
      ...berlinVtimezone,
      ...vevent({
        uid: "evt-berlin",
        lines: [
          "DTSTAMP:20260301T080000Z",
          "DTSTART;TZID=Europe/Berlin:20260302T090000",
          "DTEND;TZID=Europe/Berlin:20260302T100000",
          "SUMMARY:berlin",
        ],
      }),
      ...vevent({
        uid: "evt-unanchored",
        lines: [
          "DTSTAMP:20260301T080000Z",
          "DTSTART:20260303T090000",
          "DTEND:20260303T100000",
          "SUMMARY:unanchored",
        ],
      }),
    ]);
    const projection = project(body);

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.usable.map((identity) => identity.uid.value)).toEqual(["evt-berlin"]);
    expect(projection.value.unsupported).toEqual([
      expect.objectContaining({ reason: "unresolvableTimeZone" }),
    ]);
  });
});
