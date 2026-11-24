import { describe, expect, it } from "vitest";
import { canonicalizeTimeZone } from "../../../src/ics/utils/canonical-time-zone";
import { IANA_LINK_TARGETS, TIMEZONE_LINKS_TZDB_VERSION } from "../../../src/ics/utils/timezone-links";
import { REQUIRED_TIME_ZONE_DATA_VERSION } from "../../../src/utils/timezone-data-currency";

describe("canonicalizeTimeZone", () => {
  it.each([
    ["America/Chicago", "America/Chicago"],
    ["US/Central", "America/Chicago"],
    ["america/chicago", "America/Chicago"],
    ["  America/Chicago  ", "America/Chicago"],
    ["Central Standard Time", "America/Chicago"],
    ["/mozilla.org/20050126_1/America/Chicago", "America/Chicago"],
    ["/freeassociation.sourceforge.net/Tzfile/US/Central", "America/Chicago"],
    ["Asia/Calcutta", "Asia/Kolkata"],
    ["Europe/Kiev", "Europe/Kyiv"],
    ["UTC", "Etc/UTC"],
    ["Argentina Standard Time", "America/Argentina/Buenos_Aires"],
  ])("resolves %j to %j", (identifier, expected) => {
    expect(canonicalizeTimeZone(identifier)).toBe(expected);
  });

  it.each([[globalThis.undefined], [null], [""], ["   "], ["GMT-0600"], ["Central"], ["Not/AZone"]])(
    "leaves %j unresolved",
    (identifier) => {
      expect(canonicalizeTimeZone(identifier)).toBeUndefined();
    },
  );

  it("resolves every tzdb link to its target", () => {
    const mismatched = Object.entries(IANA_LINK_TARGETS)
      .filter(([link, target]) => canonicalizeTimeZone(link) !== target);
    expect(mismatched).toEqual([]);
  });

  it("returns names that resolve to themselves", () => {
    const unstable = Intl.supportedValuesOf("timeZone").filter((timeZone) => {
      const canonical = canonicalizeTimeZone(timeZone);
      return !canonical || canonicalizeTimeZone(canonical) !== canonical;
    });
    expect(unstable).toEqual([]);
  });

  it("uses links from the tzdb release the runtime is pinned to", () => {
    expect(TIMEZONE_LINKS_TZDB_VERSION).toBe(REQUIRED_TIME_ZONE_DATA_VERSION);
  });
});
