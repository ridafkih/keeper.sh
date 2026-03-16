import { describe, expect, it } from "bun:test";
import { normalizeTimezone } from "./normalize-timezone";

describe("normalizeTimezone", () => {
  it("returns IANA timezone unchanged", () => {
    expect(normalizeTimezone("America/New_York")).toBe("America/New_York");
  });

  it("returns UTC unchanged", () => {
    expect(normalizeTimezone("UTC")).toBe("UTC");
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

  it("returns undefined for undefined input", () => {
    expect(normalizeTimezone(undefined)).toBeUndefined();
  });

  it("returns unknown timezone as-is when not in mapping", () => {
    expect(normalizeTimezone("Invented/Timezone")).toBe("Invented/Timezone");
  });
});
