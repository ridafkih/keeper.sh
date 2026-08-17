import { describe, expect, test } from "vitest";
import { createZoneCache, reanchorRecurrenceIdentities } from "../../src/index";
import type { RecurrenceIdentitySet } from "../../src/index";
import { instant } from "../support/feed";

const tokyo = { kind: "zoneId", value: "Asia/Tokyo" } as const;
const newYork = { kind: "zoneId", value: "America/New_York" } as const;

const tokyoSeries: RecurrenceIdentitySet = {
  start: instant("2026-03-09T15:00:00.000Z"),
  exceptions: [instant("2026-03-16T15:00:00.000Z")],
  overrideInstants: [instant("2026-03-23T15:00:00.000Z")],
  until: instant("2026-04-06T15:00:00.000Z"),
};

const newYorkSeries: RecurrenceIdentitySet = {
  start: instant("2026-03-10T05:00:00.000Z"),
  exceptions: [instant("2026-03-17T04:00:00.000Z")],
  overrideInstants: [instant("2026-03-24T04:00:00.000Z")],
  until: instant("2026-04-07T04:00:00.000Z"),
};

describe("re-anchoring a full-day series onto UTC midnight", () => {
  test("ICAL-O25: a cancelled day stays cancelled in a zone ahead of UTC", () => {
    const reanchored = reanchorRecurrenceIdentities(tokyoSeries, tokyo, createZoneCache());

    expect(reanchored.start.value).toBe("2026-03-10T00:00:00.000Z");
    expect(reanchored.exceptions.map((value) => value.value)).toEqual([
      "2026-03-17T00:00:00.000Z",
    ]);
  });

  test("ICAL-O25: a detached instance still replaces the day it was moved from", () => {
    const reanchored = reanchorRecurrenceIdentities(tokyoSeries, tokyo, createZoneCache());

    expect(reanchored.overrideInstants.map((value) => value.value)).toEqual([
      "2026-03-24T00:00:00.000Z",
    ]);
  });

  test("ICAL-O25: UNTIL moves with the series, so it stops on the day the series says it stops", () => {
    const reanchored = reanchorRecurrenceIdentities(tokyoSeries, tokyo, createZoneCache());

    expect(reanchored.until?.value).toBe("2026-04-07T00:00:00.000Z");
  });

  test("ICAL-O25: a zone behind UTC re-anchors onto the UTC midnight of its own local day", () => {
    const reanchored = reanchorRecurrenceIdentities(newYorkSeries, newYork, createZoneCache());

    expect(reanchored.start.value).toBe("2026-03-10T00:00:00.000Z");
    expect(reanchored.exceptions.map((value) => value.value)).toEqual([
      "2026-03-17T00:00:00.000Z",
    ]);
    expect(reanchored.until?.value).toBe("2026-04-07T00:00:00.000Z");
  });

  test("ICAL-I27: re-anchoring twice is a fixed point, so a second poll does not shift the series", () => {
    const zones = createZoneCache();
    const once = reanchorRecurrenceIdentities(tokyoSeries, tokyo, zones);

    expect(reanchorRecurrenceIdentities(once, tokyo, zones)).toEqual(once);
  });

  test("ICAL-I27: a series with no exceptions, overrides or UNTIL is re-anchored without inventing any", () => {
    const bare: RecurrenceIdentitySet = {
      start: instant("2026-03-09T15:00:00.000Z"),
      exceptions: [],
      overrideInstants: [],
      until: null,
    };
    const reanchored = reanchorRecurrenceIdentities(bare, tokyo, createZoneCache());

    expect(reanchored.exceptions).toEqual([]);
    expect(reanchored.overrideInstants).toEqual([]);
    expect(reanchored.until).toBeNull();
  });
});
