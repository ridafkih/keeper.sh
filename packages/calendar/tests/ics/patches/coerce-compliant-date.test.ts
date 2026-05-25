import { describe, expect, it } from "vitest";
import { coerceCompliantDate } from "../../../src/ics/patches/coerce-compliant-date";

describe("coerceCompliantDate", () => {
  it("targets the four date-typed properties", () => {
    expect(coerceCompliantDate.properties).toEqual([
      "DTSTART",
      "DTEND",
      "EXDATE",
      "RDATE",
    ]);
  });

  it("rewrites a bare 8-digit date value to declare VALUE=DATE", () => {
    expect(coerceCompliantDate.coerce("", "20260515")).toEqual({
      params: ";VALUE=DATE",
      value: "20260515",
    });
  });

  it("leaves DATE-TIME values untouched", () => {
    expect(coerceCompliantDate.coerce("", "20260515T090000Z")).toBeNull();
    expect(coerceCompliantDate.coerce("", "20260515T090000")).toBeNull();
  });

  it("leaves values that already declare any parameters untouched", () => {
    expect(coerceCompliantDate.coerce(";VALUE=DATE", "20260515")).toBeNull();
    expect(coerceCompliantDate.coerce(";TZID=America/Toronto", "20260515")).toBeNull();
  });

  it("leaves non-date-shaped values untouched", () => {
    expect(coerceCompliantDate.coerce("", "not-a-date")).toBeNull();
    expect(coerceCompliantDate.coerce("", "")).toBeNull();
    expect(coerceCompliantDate.coerce("", "1234567")).toBeNull();
    expect(coerceCompliantDate.coerce("", "123456789")).toBeNull();
  });
});
