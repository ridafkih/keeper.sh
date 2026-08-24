import { describe, expect, it } from "vitest";
import {
  formatRefreshFailures,
  formatRefreshSummary,
  refreshCalendarsResponseSchema,
} from "../../../../src/features/dashboard/components/refresh-summary";

describe("formatRefreshSummary", () => {
  it("confirms the check ran when nothing changed", () => {
    expect(formatRefreshSummary({ added: 0, revived: 0, unavailable: 0 }))
      .toBe("No new calendars found.");
  });

  it("reports newly discovered calendars", () => {
    expect(formatRefreshSummary({ added: 2, revived: 0, unavailable: 0 }))
      .toBe("Found 2 new calendars.");
  });

  it("uses the singular form for a single new calendar", () => {
    expect(formatRefreshSummary({ added: 1, revived: 0, unavailable: 0 }))
      .toBe("Found 1 new calendar.");
  });

  it("reports a calendar that became available again", () => {
    expect(formatRefreshSummary({ added: 0, revived: 1, unavailable: 0 }))
      .toBe("1 calendar is available again.");
  });

  it("appends the unavailable clause without replacing the additions", () => {
    const message = formatRefreshSummary({ added: 2, revived: 0, unavailable: 1 });

    expect(message).toContain("Found 2 new calendars.");
    expect(message).toContain("1 calendar is no longer available.");
  });

  it("reports a disappearance on its own", () => {
    expect(formatRefreshSummary({ added: 0, revived: 0, unavailable: 1 }))
      .toBe("1 calendar is no longer available.");
  });
});

describe("formatRefreshFailures", () => {
  it("stays silent when every account refreshed", () => {
    expect(formatRefreshFailures(0)).toBeNull();
  });

  it("names how many accounts need attention", () => {
    expect(formatRefreshFailures(2)).toContain("2 accounts could not be refreshed");
  });

  it("uses the singular form for a single failure", () => {
    expect(formatRefreshFailures(1)).toContain("1 account could not be refreshed");
  });
});

describe("refreshCalendarsResponseSchema", () => {
  it("accepts the server payload and keeps the fields the control reads", () => {
    expect(refreshCalendarsResponseSchema.assert({
      accounts: 2,
      added: 1,
      cooldownSeconds: 60,
      failed: 0,
      refreshed: 2,
      revived: 1,
      skipped: 0,
      unavailable: 2,
    })).toMatchObject({
      accounts: 2,
      added: 1,
      cooldownSeconds: 60,
      failed: 0,
      revived: 1,
      unavailable: 2,
    });
  });

  it.each([
    ["a body without a cooldown the control can count down", {
      accounts: 1, added: 0, failed: 0, revived: 0, unavailable: 0,
    }],
    ["a non-numeric count", {
      accounts: 1, added: "1", cooldownSeconds: 60, failed: 0, revived: 0, unavailable: 0,
    }],
    ["a non-object body", "boom"],
    ["a null body", null],
  ])("rejects %s", (_label, body) => {
    expect(() => refreshCalendarsResponseSchema.assert(body)).toThrow();
  });
});
