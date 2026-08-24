import { describe, expect, it } from "vitest";
import { parseICalCalendarsToRemoteEvents } from "../../../../src/providers/caldav/shared/ics";

const BYTE_ORDER_MARK = "﻿";

const buildResource = (uid: string, extraLines: string[] = []): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Test//Test//EN",
  "BEGIN:VEVENT",
  `UID:${uid}`,
  "DTSTART:20260701T090000Z",
  "DTEND:20260701T100000Z",
  `SUMMARY:${uid}`,
  ...extraLines,
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const TRUNCATED_RESOURCE = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Test//Test//EN",
  "BEGIN:VEVENT",
  "UID:truncated",
  "DTSTART:20260701T090000Z",
].join("\r\n");

describe("parseICalCalendarsToRemoteEvents resource isolation", () => {
  it.each([
    { bad: TRUNCATED_RESOURCE, name: "truncated" },
    { bad: buildResource("rdate", ["RDATE:20260703T090000Z"]), name: "RDATE" },
  ])("keeps the rest of the collection when one resource is $name", (scenario) => {
    const result = parseICalCalendarsToRemoteEvents([
      buildResource("before"),
      scenario.bad,
      buildResource("after"),
    ]);

    expect(result.events.map(({ uid }) => uid)).toEqual(["before", "after"]);
    expect(result.skippedResourceCount).toBe(1);
    expect(result.skippedResourceReasons).toHaveLength(1);
  });

  it("reports every skipped resource", () => {
    const result = parseICalCalendarsToRemoteEvents([
      buildResource("before"),
      TRUNCATED_RESOURCE,
      buildResource("rdate", ["RDATE:20260703T090000Z"]),
    ]);

    expect(result.events.map(({ uid }) => uid)).toEqual(["before"]);
    expect(result.skippedResourceCount).toBe(2);
  });

  it("reads a BOM-prefixed resource rather than skipping it", () => {
    const result = parseICalCalendarsToRemoteEvents([
      buildResource("before"),
      `${BYTE_ORDER_MARK}${buildResource("bom")}`,
    ]);

    expect(result.events.map(({ uid }) => uid)).toEqual(["before", "bom"]);
    expect(result.skippedResourceCount).toBe(0);
  });

  it("throws when no resource in a non-empty collection could be read", () => {
    expect(() => parseICalCalendarsToRemoteEvents([TRUNCATED_RESOURCE]))
      .toThrow("Malformed ICS component boundary");
  });

  it("returns an empty result for an empty collection", () => {
    const result = parseICalCalendarsToRemoteEvents([]);

    expect(result.events).toEqual([]);
    expect(result.skippedResourceCount).toBe(0);
  });
});
