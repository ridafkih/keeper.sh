import { describe, expect, test } from "vitest";
import { createZoneCache, resolveWallTime, serialiseZonedDate } from "../../src/index";
import { instant } from "../support/feed";

const berlin = { kind: "zoneId", value: "Europe/Berlin" } as const;
const firstPass = instant("2026-10-25T00:30:00.000Z");
const secondPass = instant("2026-10-25T01:30:00.000Z");

describe("writing an instant inside a fall-back hour", () => {
  test("ICAL-O31: the first pass keeps its TZID and local wall time", () => {
    const rendering = serialiseZonedDate(firstPass, berlin, createZoneCache());

    expect(rendering.kind).toBe("localWithTzid");
    expect(rendering.text).toBe("DTSTART;TZID=Europe/Berlin:20261025T023000");
  });

  test("ICAL-O31: the second pass is written in UTC, because a TZID rendering would move it", () => {
    const rendering = serialiseZonedDate(secondPass, berlin, createZoneCache());

    expect(rendering.kind).toBe("utc");
    expect(rendering.text).toBe("DTSTART:20261025T013000Z");
  });

  test("ICAL-O31: serialise then parse returns the same instant for both passes", () => {
    const zones = createZoneCache();
    const first = serialiseZonedDate(firstPass, berlin, zones);
    const firstResolved = resolveWallTime({ kind: "wallTime", value: "20261025T023000" }, berlin, zones);

    expect(first.kind).toBe("localWithTzid");
    expect(firstResolved.instant.value).toBe(firstPass.value);
    expect(serialiseZonedDate(secondPass, berlin, zones).text).toContain("Z");
  });

  test("ICAL-I32: an unambiguous instant is written with its TZID rather than flattened to UTC", () => {
    const rendering = serialiseZonedDate(instant("2026-06-15T10:00:00.000Z"), berlin, createZoneCache());

    expect(rendering.kind).toBe("localWithTzid");
    expect(rendering.text).toBe("DTSTART;TZID=Europe/Berlin:20260615T120000");
  });

  test("ICAL-I32: the writer round-trips its own output before choosing the rendering", () => {
    const zones = createZoneCache();

    for (const value of ["2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z", "2026-03-29T01:30:00.000Z"]) {
      const rendering = serialiseZonedDate(instant(value), berlin, zones);
      expect(`${value}:${rendering.text.includes("20261025T023000") && rendering.kind === "utc"}`).toBe(
        `${value}:false`,
      );
    }
  });
});
