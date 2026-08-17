import { describe, expect, test } from "vitest";
import { filesMatching, filesMatchingPattern } from "../support/sources";

const offsetArithmetic = /getTimezoneOffset|Intl\.DateTimeFormat|timeZone\s*:\s*["'`]/;

describe("timezone knowledge lives in sync-ical, not here", () => {
  test("DAV-H10: src derives no timezone offsets of its own", async () => {
    const arithmetic = await filesMatchingPattern("src", offsetArithmetic);
    const zoneTables = await filesMatching("src", "Europe/");

    expect(arithmetic).toEqual([]);
    expect(zoneTables).toEqual([]);
  });

  test("DAV-H10: no src module names a Windows zone identifier", async () => {
    const windowsZones = await filesMatching("src", "Standard Time");

    expect(windowsZones).toEqual([]);
  });
});
