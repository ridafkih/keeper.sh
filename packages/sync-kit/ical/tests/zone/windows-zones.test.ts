import { describe, expect, test } from "vitest";
import { normalizeZoneIdentifier, projectIcsFeed, windowsZones } from "../../src/index";
import { testScope } from "../support/feed";
import { fixturePathById } from "../support/fixtures";
import { testOptions } from "../support/options";

const knownIanaZones = new Set(Intl.supportedValuesOf("timeZone"));

const outlookFixture = fixturePathById("outlook-exchange-windows-timezones");

describe("the CLDR windowsZones table", () => {
  test("ICAL-O30: every mapped IANA name is known to Intl.supportedValuesOf", () => {
    const entries = Object.keys(windowsZones);

    expect(entries.length).toBeGreaterThanOrEqual(100);
    for (const windowsName of entries) {
      const mapped = normalizeZoneIdentifier(windowsName);
      expect(mapped).not.toBeNull();
      expect(knownIanaZones.has(String(mapped))).toBe(true);
    }
  });

  test("ICAL-O30: the backward-linked zones the table still carries resolve to live names", () => {
    for (const legacy of ["Asia/Calcutta", "Europe/Kiev", "America/Godthab"]) {
      const mapped = normalizeZoneIdentifier(legacy);
      expect(mapped).not.toBeNull();
      expect(knownIanaZones.has(String(mapped))).toBe(true);
    }
  });

  test("ICAL-O29: a Windows identifier never survives into the canonical projection", async () => {
    const body = await Bun.file(outlookFixture).text();
    const projection = projectIcsFeed({
      body,
      scope: testScope,
      previousContentHash: null,
      options: testOptions(),
    });

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    const zones = projection.value.listing.events.flatMap((event) => {
      if (!event.content.time || event.content.time.kind !== "timed") {
        return [];
      }
      if (event.content.time.zone === null) {
        return [];
      }
      return [event.content.time.zone.value];
    });

    expect(zones.length).toBeGreaterThan(0);
    for (const zone of zones) {
      expect(knownIanaZones.has(zone)).toBe(true);
    }
  });

  test("ICAL-I17: an identifier already in IANA form passes through unchanged", () => {
    expect(normalizeZoneIdentifier("America/New_York")).toBe("America/New_York");
  });

  test("ICAL-I17: an identifier in neither table is reported as unmapped, never guessed", () => {
    expect(normalizeZoneIdentifier("Middle-earth/Shire")).toBeNull();
  });
});
