import { describe, expect, it } from "vitest";
import {
  buildSetupSearchForNewCalendars,
  formatRefreshSummary,
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
