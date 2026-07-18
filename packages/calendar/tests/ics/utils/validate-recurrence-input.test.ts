import { describe, expect, it } from "vitest";
import { assertNoUnsupportedRecurrenceDates } from "../../../src/ics/utils/validate-recurrence-input";

describe("assertNoUnsupportedRecurrenceDates", () => {
  it("rejects folded RDATE properties inside VEVENT", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "RDATE;VALUE=DATE:20260701,",
      " 20260702",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    expect(() => assertNoUnsupportedRecurrenceDates(ics))
      .toThrow("ICS RDATE recurrence is not supported");
  });

  it("allows RDATE inside VTIMEZONE observances supported by ts-ics", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VTIMEZONE",
      "BEGIN:STANDARD",
      "RDATE:20260701T000000",
      "END:STANDARD",
      "END:VTIMEZONE",
      "END:VCALENDAR",
    ].join("\r\n");

    expect(() => assertNoUnsupportedRecurrenceDates(ics)).not.toThrow();
  });

  it("fails closed when a mismatched component boundary tries to hide event RDATE", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "END:VALARM",
      "RDATE:20260701T090000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    expect(() => assertNoUnsupportedRecurrenceDates(ics))
      .toThrow("expected END:VEVENT, received END:VALARM");
  });
});
