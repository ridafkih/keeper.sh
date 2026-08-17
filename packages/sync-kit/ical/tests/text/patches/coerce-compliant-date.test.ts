import { describe, expect, test } from "vitest";
import { applyIcsPatches, coerceCompliantDate, projectIcsFeed } from "../../../src/index";
import { calendarWith, testScope, vevent } from "../../support/feed";
import { testLimits, testOptions } from "../../support/options";

const patchedText = (body: string): string => {
  const outcome = applyIcsPatches(body, [coerceCompliantDate], testLimits());
  if (outcome.kind !== "patched") {
    return "";
  }
  return outcome.text;
};

describe("the bare 8-digit date coercion", () => {
  test("ICAL-O35: a genuine calendar date is coerced to VALUE=DATE and round-trips", () => {
    expect(coerceCompliantDate.coerce("", "20260310")).toEqual({
      params: ";VALUE=DATE",
      value: "20260310",
    });
  });

  test("ICAL-O35: a 13th month is declined rather than rolled over into a phantom day", () => {
    expect(coerceCompliantDate.coerce("", "20261301")).toBeNull();
  });

  test("ICAL-O35: a 30th of February is declined rather than rolled over into March", () => {
    expect(coerceCompliantDate.coerce("", "20260230")).toBeNull();
  });

  test("ICAL-O35: a leap day that does not exist in that year is declined", () => {
    expect(coerceCompliantDate.coerce("", "20260229")).toBeNull();
    expect(coerceCompliantDate.coerce("", "20240229")).toEqual({
      params: ";VALUE=DATE",
      value: "20240229",
    });
  });

  test("ICAL-O35: the VEVENT carrying an impossible date is withheld, never written", () => {
    const projection = projectIcsFeed({
      body: calendarWith(
        vevent({
          uid: "evt-impossible",
          lines: ["DTSTAMP:20260310T080000Z", "DTSTART:20261301", "SUMMARY:phantom"],
        }),
      ),
      scope: testScope,
      previousContentHash: null,
      options: testOptions(),
    });

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.usable).toEqual([]);
    expect(projection.value.unsupported).toEqual([
      expect.objectContaining({ reason: "unparseable" }),
    ]);
  });

  test("ICAL-O36: a property carrying a TZID is never rewritten", () => {
    expect(coerceCompliantDate.coerce(";TZID=Europe/Berlin", "20260310")).toBeNull();
  });

  test("ICAL-O36: a property carrying any parameter at all is emitted unchanged", () => {
    const body = calendarWith(
      vevent({
        uid: "evt-parameterised",
        lines: ["DTSTAMP:20260310T080000Z", "DTSTART;TZID=Europe/Berlin:20260310"],
      }),
    );

    expect(patchedText(body)).toContain("DTSTART;TZID=Europe/Berlin:20260310");
  });

  test("ICAL-O36: a mixed EXDATE list is refused rather than half-coerced", () => {
    expect(coerceCompliantDate.coerce("", "20260310,20260317T090000Z")).toBeNull();
  });

  test("ICAL-O36: an all-date EXDATE list is coerced as one value", () => {
    expect(coerceCompliantDate.coerce("", "20260310,20260317")).toEqual({
      params: ";VALUE=DATE",
      value: "20260310,20260317",
    });
  });

  test("ICAL-I16: a value that is already a date-time is left alone", () => {
    expect(coerceCompliantDate.coerce("", "20260310T090000Z")).toBeNull();
  });
});
