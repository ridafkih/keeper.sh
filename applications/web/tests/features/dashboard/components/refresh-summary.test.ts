import { describe, expect, it } from "vitest";
import {
  buildSetupSearchForNewCalendars,
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

describe("buildSetupSearchForNewCalendars", () => {
  it("routes new calendars straight into the rename step of the setup wizard", () => {
    expect(buildSetupSearchForNewCalendars(["calendar-a", "calendar-b"]))
      .toEqual({ id: "calendar-a,calendar-b", step: "rename" });
  });

  it("offers no link when nothing was added", () => {
    expect(buildSetupSearchForNewCalendars([])).toBeNull();
  });
});

describe("refreshCalendarsResponseSchema", () => {
  it("accepts the server payload and keeps the fields the summary reads", () => {
    expect(refreshCalendarsResponseSchema.assert({
      added: [{ id: "calendar-a", name: "Work" }],
      checkedAt: "2026-01-02T03:04:05.000Z",
      revived: 1,
      suppressed: false,
      unavailable: 2,
      unchanged: 3,
    })).toMatchObject({
      added: [{ id: "calendar-a", name: "Work" }],
      revived: 1,
      unavailable: 2,
    });
  });

  it.each([
    ["a missing added list", { revived: 0, unavailable: 0 }],
    ["added entries without an id", { added: [{ name: "Work" }], revived: 0, unavailable: 0 }],
    ["a non-numeric count", { added: [], revived: "1", unavailable: 0 }],
    ["a non-object body", "boom"],
    ["a null body", null],
  ])("rejects %s", (_label, body) => {
    expect(() => refreshCalendarsResponseSchema.assert(body)).toThrow();
  });
});
