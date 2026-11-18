import { describe, expect, it } from "vitest";
import { canRefreshCalendars } from "../../src/utils/accounts";

describe("canRefreshCalendars", () => {
  it("offers a calendar refresh for OAuth and CalDAV accounts", () => {
    expect(canRefreshCalendars({ authType: "oauth" })).toBe(true);
    expect(canRefreshCalendars({ authType: "caldav" })).toBe(true);
  });

  it("hides the calendar refresh for accounts that cannot list calendars", () => {
    expect(canRefreshCalendars({ authType: "none" })).toBe(false);
  });
});
