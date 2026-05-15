import { describe, expect, it } from "vitest";

import { normalizeTimezoneOffset, toLocalizedTime } from "../src/toolset";

describe("normalizeTimezoneOffset", () => {
  it("returns +00:00 for an empty offset (UTC)", () => {
    expect(normalizeTimezoneOffset("")).toBe("+00:00");
  });

  it("pads negative single-digit offsets correctly", () => {
    // Regression: padStart(3, "+0") on "-3" used to yield "+-3:00".
    expect(normalizeTimezoneOffset("-3")).toBe("-03:00");
  });

  it("pads positive single-digit offsets correctly", () => {
    expect(normalizeTimezoneOffset("+5")).toBe("+05:00");
  });

  it("defaults to + when no sign is present", () => {
    expect(normalizeTimezoneOffset("5")).toBe("+05:00");
  });

  it("normalizes short colon-separated offsets", () => {
    expect(normalizeTimezoneOffset("-3:00")).toBe("-03:00");
    expect(normalizeTimezoneOffset("+5:30")).toBe("+05:30");
  });

  it("passes canonical offsets through unchanged", () => {
    expect(normalizeTimezoneOffset("-10:00")).toBe("-10:00");
    expect(normalizeTimezoneOffset("+05:30")).toBe("+05:30");
  });

  it("handles compact (colon-less) offsets", () => {
    expect(normalizeTimezoneOffset("-1030")).toBe("-10:30");
    expect(normalizeTimezoneOffset("+0530")).toBe("+05:30");
  });

  it("returns the raw input when it does not match a known offset shape", () => {
    expect(normalizeTimezoneOffset("not-an-offset")).toBe("not-an-offset");
  });
});

describe("toLocalizedTime", () => {
  it("serializes Montevideo time with a valid ISO 8601 offset", () => {
    const localized = toLocalizedTime("2026-05-18T14:00:00.000Z", "America/Montevideo");
    expect(localized).toBe("2026-05-18T11:00:00-03:00");
  });

  it("serializes UTC times with a +00:00 offset", () => {
    const localized = toLocalizedTime("2026-05-18T14:00:00.000Z", "UTC");
    expect(localized).toBe("2026-05-18T14:00:00+00:00");
  });

  it("serializes a half-hour offset zone (Kolkata) correctly", () => {
    const localized = toLocalizedTime("2026-05-18T14:00:00.000Z", "Asia/Kolkata");
    expect(localized).toBe("2026-05-18T19:30:00+05:30");
  });
});
