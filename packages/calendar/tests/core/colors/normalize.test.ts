import { describe, expect, it } from "vitest";
import {
  normalizeHexColor,
  resolveCalDAVCalendarColor,
  resolveGoogleCalendarColor,
  resolveGoogleEventColor,
  resolveIcsColor,
  resolveOutlookCalendarColor,
  resolveOutlookCategoryColor,
} from "../../../src/core/colors/normalize";

describe("normalizeHexColor", () => {
  it("lowercases and trims a six-digit hex", () => {
    expect(normalizeHexColor("  #33B679 ")).toBe("#33b679");
  });

  it("expands #rgb shorthand", () => {
    expect(normalizeHexColor("#fa0")).toBe("#ffaa00");
  });

  it("expands #rgba shorthand and drops alpha", () => {
    expect(normalizeHexColor("#fa08")).toBe("#ffaa00");
  });

  it("strips the alpha byte from #rrggbbaa", () => {
    expect(normalizeHexColor("#711A76FF")).toBe("#711a76");
  });

  it.each(["33b679", "#33b67", "#33b6790", "#gggggg", "", "#"])(
    "rejects %j",
    (value) => {
      expect(normalizeHexColor(value)).toBeNull();
    },
  );
});

describe("resolveIcsColor", () => {
  it("resolves a CSS3 color name case-insensitively", () => {
    expect(resolveIcsColor("Turquoise")).toBe("#40e0d0");
  });

  it("accepts out-of-spec hex values", () => {
    expect(resolveIcsColor("#D63A47")).toBe("#d63a47");
  });

  it.each([globalThis.undefined, "", "not-a-color"])("returns undefined for %j", (value) => {
    expect(resolveIcsColor(value)).toBeUndefined();
  });
});

describe("resolveGoogleEventColor", () => {
  it("maps a colorId to the modern palette", () => {
    expect(resolveGoogleEventColor("2")).toBe("#33b679");
    expect(resolveGoogleEventColor("11")).toBe("#d50000");
  });

  it.each([globalThis.undefined, "", "12"])("returns undefined for %j", (colorId) => {
    expect(resolveGoogleEventColor(colorId)).toBeUndefined();
  });
});

describe("resolveGoogleCalendarColor", () => {
  it("normalizes the calendar list hex", () => {
    expect(resolveGoogleCalendarColor("#9FE1E7")).toBe("#9fe1e7");
  });

  it.each([globalThis.undefined, "", "garbage"])("returns null for %j", (value) => {
    expect(resolveGoogleCalendarColor(value)).toBeNull();
  });
});

describe("resolveOutlookCategoryColor", () => {
  it("maps a preset to its hex", () => {
    expect(resolveOutlookCategoryColor("preset7")).toBe("#5ca9e5");
  });

  it.each([globalThis.undefined, null, "none", "preset25"])("returns undefined for %j", (preset) => {
    expect(resolveOutlookCategoryColor(preset)).toBeUndefined();
  });
});

describe("resolveOutlookCalendarColor", () => {
  it("prefers a non-empty hexColor", () => {
    expect(resolveOutlookCalendarColor("#FF8C00", "lightBlue")).toBe("#ff8c00");
  });

  it("falls back to the enum table when hexColor is empty", () => {
    expect(resolveOutlookCalendarColor("", "lightBlue")).toBe("#71afe5");
    expect(resolveOutlookCalendarColor(globalThis.undefined, "lightGreen")).toBe("#87d28e");
  });

  it.each([
    [globalThis.undefined, "auto"],
    [globalThis.undefined, "maxColor"],
    [globalThis.undefined, globalThis.undefined],
    ["", "unknownColor"],
  ])("returns null for hexColor=%j color=%j", (hexColor, colorName) => {
    expect(resolveOutlookCalendarColor(hexColor, colorName)).toBeNull();
  });
});

describe("resolveCalDAVCalendarColor", () => {
  it("strips the alpha byte apple servers append", () => {
    expect(resolveCalDAVCalendarColor("#711A76FF")).toBe("#711a76");
  });

  it("accepts a CSS3 name", () => {
    expect(resolveCalDAVCalendarColor("teal")).toBe("#008080");
  });

  it.each([globalThis.undefined, null, 42, {}, "garbage"])("returns null for %j", (value) => {
    expect(resolveCalDAVCalendarColor(value)).toBeNull();
  });
});
