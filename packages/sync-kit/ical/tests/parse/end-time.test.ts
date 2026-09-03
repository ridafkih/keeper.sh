import { describe, expect, test } from "vitest";
import { parseIcsDocument, resolveEndTime } from "../../src/index";
import type { VeventComponent } from "../../src/index";
import { calendarWith, vevent } from "../support/feed";
import { testOptions } from "../support/options";

const componentsOf = (lines: readonly string[]): readonly VeventComponent[] => {
  const document = parseIcsDocument(calendarWith(lines), testOptions());
  if (document.kind !== "readable") {
    return [];
  }
  return document.components;
};

const firstComponent = (lines: readonly string[]): VeventComponent | undefined =>
  componentsOf(lines).at(0);

describe("RFC 5545 §3.6.1 end-time defaults", () => {
  test("ICAL-I24: a date-only DTSTART with no DTEND and no DURATION lasts exactly one day", () => {
    const component = firstComponent(
      vevent({
        uid: "evt-all-day",
        lines: ["DTSTAMP:20260310T080000Z", "DTSTART;VALUE=DATE:20260310"],
      }),
    );

    expect(component).toBeDefined();
    if (!component) {
      return;
    }
    expect(resolveEndTime(component, testOptions())).toEqual({
      kind: "resolved",
      time: {
        kind: "allDay",
        startDate: { kind: "calendarDate", value: "2026-03-10" },
        endDateExclusive: { kind: "calendarDate", value: "2026-03-11" },
      },
    });
  });

  test("ICAL-I24: a date-time DTSTART with no DTEND and no DURATION is zero length, not a guessed hour", () => {
    const component = firstComponent(
      vevent({
        uid: "evt-instant",
        lines: ["DTSTAMP:20260310T080000Z", "DTSTART:20260310T090000Z"],
      }),
    );

    expect(component).toBeDefined();
    if (!component) {
      return;
    }
    const resolution = resolveEndTime(component, testOptions());
    expect(resolution.kind).toBe("resolved");
    if (resolution.kind !== "resolved" || resolution.time.kind !== "timed") {
      return;
    }
    expect(resolution.time.end.value).toBe(resolution.time.start.value);
  });

  test("ICAL-I24: a DTEND before DTSTART is unbuildable, never repaired into a plausible range", () => {
    const component = firstComponent(
      vevent({
        uid: "evt-inverted",
        lines: [
          "DTSTAMP:20260310T080000Z",
          "DTSTART:20260310T100000Z",
          "DTEND:20260310T090000Z",
        ],
      }),
    );

    expect(component).toBeDefined();
    if (!component) {
      return;
    }
    expect(resolveEndTime(component, testOptions())).toEqual({ kind: "unbuildable" });
  });

  test("ICAL-I24: an all-day DTSTART with an hour-based DURATION is unbuildable", () => {
    const component = firstComponent(
      vevent({
        uid: "evt-hour-all-day",
        lines: ["DTSTAMP:20260310T080000Z", "DTSTART;VALUE=DATE:20260310", "DURATION:PT1H"],
      }),
    );

    expect(component).toBeDefined();
    if (!component) {
      return;
    }
    expect(resolveEndTime(component, testOptions())).toEqual({ kind: "unbuildable" });
  });
});
