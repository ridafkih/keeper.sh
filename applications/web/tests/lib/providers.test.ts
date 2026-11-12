import { describe, expect, it } from "vitest";
import { providerCalendarApp } from "../../src/lib/providers";

describe("providerCalendarApp", () => {
  it("opens the provider's own calendar app where copies can be seen", () => {
    expect(providerCalendarApp("google")).toEqual({
      label: "Open Google Calendar",
      url: "https://calendar.google.com",
    });
    expect(providerCalendarApp("microsoft-365")).toEqual(providerCalendarApp("outlook"));
  });

  it("has nothing to open for a calendar link or a generic CalDAV server", () => {
    expect(providerCalendarApp("ics")).toBeNull();
    expect(providerCalendarApp("caldav")).toBeNull();
  });
});
