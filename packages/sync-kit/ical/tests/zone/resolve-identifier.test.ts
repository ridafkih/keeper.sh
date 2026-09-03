import { describe, expect, test } from "vitest";
import { resolveZoneIdentifier } from "../../src/index";
import type { DeclaredZone } from "../../src/index";

const resolve = (identifier: string, declared: readonly DeclaredZone[] = []) =>
  resolveZoneIdentifier(identifier, declared);

describe("the zone resolution ladder", () => {
  test("ICAL-I18: an IANA identifier resolves on the first rung", () => {
    expect(resolve("Europe/Berlin")).toEqual({
      kind: "resolved",
      zone: { kind: "zoneId", value: "Europe/Berlin" },
      via: "ianaDirect",
    });
  });

  test("ICAL-I18: a Windows identifier resolves through the CLDR table", () => {
    expect(resolve("Eastern Standard Time")).toEqual({
      kind: "resolved",
      zone: { kind: "zoneId", value: "America/New_York" },
      via: "windowsCldr",
    });
  });

  test("ICAL-I18: a tzurl-style identifier resolves through its embedded IANA segment", () => {
    expect(resolve("/citadel.org/20190914_1/America/Chicago")).toEqual({
      kind: "resolved",
      zone: { kind: "zoneId", value: "America/Chicago" },
      via: "embeddedIanaSegment",
    });
  });

  test("ICAL-I18: an unknown TZID whose declared block never changes offset resolves to that offset", () => {
    const declared: DeclaredZone = {
      declaredId: "Acme/Fixed",
      observances: "explicit",
      offsets: [-300],
    };

    expect(resolve("Acme/Fixed", [declared])).toEqual({
      kind: "resolved",
      zone: { kind: "zoneId", value: "Etc/GMT+5" },
      via: "declaredFixedOffset",
    });
  });

  test("ICAL-O28: a VTIMEZONE that changes offset is refused rather than flattened", () => {
    const declared: DeclaredZone = {
      declaredId: "Acme/Daylight",
      observances: "explicit",
      offsets: [60, 120],
    };

    expect(resolve("Acme/Daylight", [declared])).toEqual({
      kind: "unsupported",
      identifier: "Acme/Daylight",
      reason: "declaredZoneChangesOffset",
    });
  });

  test("ICAL-O28: the ladder ends in a typed refusal, never in a guessed zone", () => {
    expect(resolve("Middle-earth/Shire")).toEqual({
      kind: "unsupported",
      identifier: "Middle-earth/Shire",
      reason: "unknownIdentifier",
    });
  });

  test("ICAL-I22: a declared sub-minute offset is refused rather than truncated", () => {
    const declared: DeclaredZone = {
      declaredId: "Acme/Almost",
      observances: "explicit",
      offsets: [30.5],
    };

    expect(resolve("Acme/Almost", [declared])).toEqual({
      kind: "unsupported",
      identifier: "Acme/Almost",
      reason: "subMinuteOffset",
    });
  });
});
