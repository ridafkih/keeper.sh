import { describe, expect, it } from "vitest";
import { normalizeTimezone } from "../../../src/ics/utils/normalize-timezone";
import { isSupportedTimeZone } from "../../../src/ics/utils/timezone-instant";
import { WINDOWS_TO_IANA } from "../../../src/ics/utils/windows-timezones";

describe("normalizeTimezone", () => {
  it("returns IANA timezone unchanged", () => {
    expect(normalizeTimezone("America/New_York")).toBe("America/New_York");
  });

  it("maps Windows 'UTC' to Etc/UTC", () => {
    expect(normalizeTimezone("UTC")).toBe("Etc/UTC");
  });

  it("maps 'Eastern Standard Time' to America/New_York", () => {
    expect(normalizeTimezone("Eastern Standard Time")).toBe("America/New_York");
  });

  it("maps 'Central Standard Time' to America/Chicago", () => {
    expect(normalizeTimezone("Central Standard Time")).toBe("America/Chicago");
  });

  it("maps 'Pacific Standard Time' to America/Los_Angeles", () => {
    expect(normalizeTimezone("Pacific Standard Time")).toBe("America/Los_Angeles");
  });

  it("maps 'Mountain Standard Time' to America/Denver", () => {
    expect(normalizeTimezone("Mountain Standard Time")).toBe("America/Denver");
  });

  it("maps 'GMT Standard Time' to Europe/London", () => {
    expect(normalizeTimezone("GMT Standard Time")).toBe("Europe/London");
  });

  it("maps 'W. Europe Standard Time' to Europe/Berlin", () => {
    expect(normalizeTimezone("W. Europe Standard Time")).toBe("Europe/Berlin");
  });

  it("maps 'Tokyo Standard Time' to Asia/Tokyo", () => {
    expect(normalizeTimezone("Tokyo Standard Time")).toBe("Asia/Tokyo");
  });

  it("maps 'AUS Eastern Standard Time' to Australia/Sydney", () => {
    expect(normalizeTimezone("AUS Eastern Standard Time")).toBe("Australia/Sydney");
  });

  it.each([
    { ianaTimeZone: "America/Edmonton", windowsTimeZone: "Alberta Standard Time" },
    { ianaTimeZone: "America/Vancouver", windowsTimeZone: "British Columbia Standard Time" },
    { ianaTimeZone: "America/Winnipeg", windowsTimeZone: "Manitoba Standard Time" },
  ])("maps the 2026 Windows zone '$windowsTimeZone' to $ianaTimeZone", ({ ianaTimeZone, windowsTimeZone }) => {
    expect(normalizeTimezone(windowsTimeZone)).toBe(ianaTimeZone);
  });

  it.each(Object.entries(WINDOWS_TO_IANA))("maps '%s' to a timezone the runtime supports", (windowsTimeZone, ianaTimeZone) => {
    expect(isSupportedTimeZone(ianaTimeZone)).toBe(true);
  });

  it("returns undefined for undefined input", () => {
    expect(normalizeTimezone(globalThis.undefined)).toBeUndefined();
  });

  it("returns unknown timezone as-is when not in mapping", () => {
    expect(normalizeTimezone("Invented/Timezone")).toBe("Invented/Timezone");
  });
  it.each([
    { identifier: "/mozilla.org/20050126_1/America/Denver", timeZone: "America/Denver" },
    { identifier: "/citadel.org/20190914_1/Europe/London", timeZone: "Europe/London" },
  ])("recovers the IANA zone carried by the tzurl id '$identifier'", ({ identifier, timeZone }) => {
    expect(normalizeTimezone(identifier)).toBe(timeZone);
  });

  it.each([
    "Customized Time Zone",
    "Invented/Timezone",
    "GMT+8",
    "(UTC+05:30) Chennai, Kolkata, Mumbai, New Delhi",
    "(UTC+08:00) Kuala Lumpur, Singapore",
  ])("passes the unresolvable label '%s' back as given", (identifier) => {
    expect(normalizeTimezone(identifier)).toBe(identifier);
  });

  it.each([
    "Asia/Calcutta",
    "US/Eastern",
    "Asia/Rangoon",
    "Europe/Kiev",
  ])("keeps the IANA link '%s' as given", (identifier) => {
    expect(normalizeTimezone(identifier)).toBe(identifier);
  });

  it("returns undefined for an empty string", () => {
    expect(normalizeTimezone("")).toBeUndefined();
  });
});
