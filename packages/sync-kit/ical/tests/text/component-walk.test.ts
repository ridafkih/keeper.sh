import { describe, expect, test } from "vitest";
import { detectEventLevelRecurrenceDates, parseIcsDocument, walkComponents } from "../../src/index";
import { calendarWith, crlf, vevent } from "../support/feed";
import { testLimits, testOptions } from "../support/options";

const declaringEvent = vevent({
  uid: "evt-declares-rdate",
  lines: [
    "DTSTAMP:20260301T080000Z",
    "DTSTART:20260302T090000Z",
    "DTEND:20260302T100000Z",
    "RDATE:20260309T090000Z",
    "SUMMARY:declares rdate",
  ],
});

const adjacentEvent = vevent({
  uid: "evt-adjacent",
  lines: [
    "DTSTAMP:20260301T080000Z",
    "DTSTART:20260303T090000Z",
    "DTEND:20260303T100000Z",
    "SUMMARY:adjacent",
  ],
});

const observanceRdate = [
  "BEGIN:VTIMEZONE",
  "TZID:Custom/Observance",
  "BEGIN:STANDARD",
  "DTSTART:19701025T030000",
  "RDATE:19701025T030000",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "END:STANDARD",
  "END:VTIMEZONE",
] as const;

describe("the component boundary walker", () => {
  test("ICAL-O10: an RDATE does not leak onto the next adjacent event", () => {
    const body = calendarWith([...declaringEvent, ...adjacentEvent]);

    expect(detectEventLevelRecurrenceDates(body, testLimits()).map((uid) => uid.value)).toEqual([
      "evt-declares-rdate",
    ]);
  });

  test("ICAL-O10: an RDATE inside a VTIMEZONE observance is not attributed to any event", () => {
    const body = calendarWith([...observanceRdate, ...adjacentEvent]);

    expect(detectEventLevelRecurrenceDates(body, testLimits())).toEqual([]);
  });

  test("ICAL-O10: two sibling VEVENTs are distinguished by their component instance path", () => {
    const body = calendarWith([...declaringEvent, ...adjacentEvent]);
    const walk = walkComponents(body, testLimits());

    expect(walk.kind).toBe("walked");
    if (walk.kind !== "walked") {
      return;
    }
    const rdateProperties = walk.properties.filter(
      (property) => property.property.name === "RDATE",
    );
    expect(rdateProperties).toHaveLength(1);
    const [rdate] = rdateProperties;
    expect(rdate).toBeDefined();
    if (!rdate) {
      return;
    }
    expect(rdate.componentPath).toEqual(["VCALENDAR", "VEVENT"]);
    expect(rdate.componentInstancePath).toEqual([0, 0]);
  });

  test("ICAL-O11: a mismatched component boundary fails closed", () => {
    const body = crlf([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:evt-1",
      "DTSTAMP:20260301T080000Z",
      "DTSTART:20260302T090000Z",
      "RDATE:20260309T090000Z",
      "END:VTIMEZONE",
      "END:VCALENDAR",
    ]);

    expect(walkComponents(body, testLimits())).toEqual({
      kind: "refused",
      reason: "componentBoundaryMismatch",
    });
  });

  test("ICAL-O11: the mismatched boundary refuses the document rather than yielding a best-effort parse", () => {
    const body = crlf([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:evt-1",
      "DTSTAMP:20260301T080000Z",
      "END:VTIMEZONE",
      "END:VCALENDAR",
    ]);

    expect(parseIcsDocument(body, testOptions())).toEqual({
      kind: "unreadable",
      reason: "componentBoundaryMismatch",
    });
  });

  test("ICAL-O11: an unclosed component is a mismatch, not an implicit close at end of body", () => {
    const body = crlf(["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:evt-1"]);

    expect(walkComponents(body, testLimits()).kind).toBe("refused");
  });
});
