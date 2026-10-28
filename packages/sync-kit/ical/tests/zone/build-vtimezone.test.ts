import { describe, expect, test } from "vitest";
import { buildVtimezone } from "../../src/index";
import type { VtimezoneBlock } from "../../src/index";
import { testOptions } from "../support/options";

const textOf = (block: VtimezoneBlock): string => {
  if (block.kind === "unresolvableZone") {
    return "";
  }
  return block.text;
};

const build = (zone: string, year = 2026) =>
  buildVtimezone({ kind: "zoneId", value: zone }, year, testOptions());

describe("synthesising a VTIMEZONE for a zone we are about to write", () => {
  test("ICAL-I31: a stable annual rule is emitted only after the full projection round-trips", () => {
    const block = build("Europe/Berlin");

    expect(block.kind).toBe("annualRule");
    expect(textOf(block)).toContain("RRULE:FREQ=YEARLY");
    expect(textOf(block)).toContain("TZID:Europe/Berlin");
  });

  test("ICAL-I31: a southern-hemisphere zone keeps its transition direction", () => {
    const block = build("Australia/Sydney");

    expect(textOf(block)).toContain("BEGIN:DAYLIGHT");
    expect(textOf(block)).toContain("BEGIN:STANDARD");
    expect(textOf(block)).toContain("TZOFFSETTO:+1100");
  });

  test("ICAL-I31: a non-hour transition size survives synthesis", () => {
    const block = build("Australia/Lord_Howe");

    expect(textOf(block)).toContain("TZOFFSETFROM:+1030");
    expect(textOf(block)).toContain("TZOFFSETTO:+1100");
  });

  test("ICAL-I31: a fixed-offset zone emits one baseline STANDARD observance and no rule", () => {
    const block = build("UTC");

    expect(block.kind).toBe("explicitObservances");
    expect(textOf(block)).toContain("BEGIN:STANDARD");
    expect(textOf(block)).not.toContain("RRULE");
    expect(textOf(block)).not.toContain("BEGIN:DAYLIGHT");
  });

  test("ICAL-I31: a Windows identifier is normalised before the zone is projected", () => {
    const block = buildVtimezone(
      { kind: "zoneId", value: "Eastern Standard Time" },
      2026,
      testOptions(),
    );

    expect(textOf(block)).toContain("TZID:America/New_York");
  });

  test("ICAL-O44: an identifier we cannot resolve refuses, rather than silently projecting UTC", () => {
    const block = build("Middle-earth/Shire");

    expect(block.kind).toBe("unresolvableZone");
    expect(textOf(block)).toBe("");
  });

  test("ICAL-I31: an old reference year does not truncate the rules current events need", () => {
    const historic = build("Europe/Berlin", 1996);
    const current = build("Europe/Berlin", 2026);

    expect(textOf(historic)).not.toBe("");
    expect(current.kind).toBe("annualRule");
  });
});
