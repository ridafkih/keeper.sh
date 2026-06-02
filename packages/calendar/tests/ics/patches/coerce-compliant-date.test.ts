import { describe, expect, it } from "vitest";
import { coerceCompliantDate } from "../../../src/ics/patches/coerce-compliant-date";

describe("coerceCompliantDate", () => {
  it("targets the date-typed properties whose VALUE=DATE shape downstream consumers read", () => {
    expect(coerceCompliantDate.properties).toEqual([
      "DTSTART",
      "DTEND",
      "EXDATE",
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

  it("rejects 8-digit strings whose components don't form a real calendar date", () => {
    expect(coerceCompliantDate.coerce("", "20261301")).toBeNull();
    expect(coerceCompliantDate.coerce("", "20260230")).toBeNull();
    expect(coerceCompliantDate.coerce("", "20260000")).toBeNull();
    expect(coerceCompliantDate.coerce("", "20260132")).toBeNull();
    expect(coerceCompliantDate.coerce("", "00000000")).toBeNull();
    expect(coerceCompliantDate.coerce("", "99999999")).toBeNull();
  });

  it("accepts edge-of-month dates that are real", () => {
    expect(coerceCompliantDate.coerce("", "20240229")).toEqual({
      params: ";VALUE=DATE",
      value: "20240229",
    });
    expect(coerceCompliantDate.coerce("", "20260131")).toEqual({
      params: ";VALUE=DATE",
      value: "20260131",
    });
  });

  it("rewrites a comma-separated list of bare dates (RFC 5545 §3.8.5.1 EXDATE shape)", () => {
    expect(coerceCompliantDate.coerce("", "20260515,20260522,20260529")).toEqual({
      params: ";VALUE=DATE",
      value: "20260515,20260522,20260529",
    });
  });

  it("rejects mixed lists where any token is not a real bare date", () => {
    expect(coerceCompliantDate.coerce("", "20260515,20260515T090000Z")).toBeNull();
    expect(coerceCompliantDate.coerce("", "20260515,not-a-date")).toBeNull();
    expect(coerceCompliantDate.coerce("", "20260515,20260230")).toBeNull();
    expect(coerceCompliantDate.coerce("", "20260515,")).toBeNull();
    expect(coerceCompliantDate.coerce("", ",20260515")).toBeNull();
  });
});
