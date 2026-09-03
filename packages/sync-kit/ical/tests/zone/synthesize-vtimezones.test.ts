import { describe, expect, test } from "vitest";
import { synthesizeMissingVtimezones } from "../../src/index";
import { calendarWith, vevent } from "../support/feed";
import { testOptions } from "../support/options";

const referencesUndefinedZone = calendarWith([
  ...vevent({
    uid: "evt-1",
    lines: [
      "DTSTAMP:20260101T000000Z",
      "DTSTART;TZID=Europe/Berlin:20260310T090000",
      "DTEND;TZID=Europe/Berlin:20260310T100000",
      "SUMMARY:no vtimezone declared",
    ],
  }),
]);

describe("a TZID the document references but never defines", () => {
  test("ICAL-I30: a VTIMEZONE is synthesised under the referenced identifier", () => {
    const synthesised = synthesizeMissingVtimezones(referencesUndefinedZone, testOptions());

    expect(synthesised).toContain("BEGIN:VTIMEZONE");
    expect(synthesised).toContain("TZID:Europe/Berlin");
  });

  test("ICAL-I30: the event's own TZID parameter is left pointing at the same identifier", () => {
    const synthesised = synthesizeMissingVtimezones(referencesUndefinedZone, testOptions());

    expect(synthesised).toContain("DTSTART;TZID=Europe/Berlin:20260310T090000");
  });

  test("ICAL-I30: a document that already defines the zone is returned unchanged", () => {
    const alreadyDefined = calendarWith([
      "BEGIN:VTIMEZONE",
      "TZID:Europe/Berlin",
      "BEGIN:STANDARD",
      "DTSTART:19701025T030000",
      "TZOFFSETFROM:+0200",
      "TZOFFSETTO:+0100",
      "END:STANDARD",
      "END:VTIMEZONE",
      ...vevent({
        uid: "evt-1",
        lines: ["DTSTAMP:20260101T000000Z", "DTSTART;TZID=Europe/Berlin:20260310T090000"],
      }),
    ]);

    expect(synthesizeMissingVtimezones(alreadyDefined, testOptions())).toBe(alreadyDefined);
  });

  test("ICAL-I30: synthesising twice is a fixed point", () => {
    const once = synthesizeMissingVtimezones(referencesUndefinedZone, testOptions());

    expect(synthesizeMissingVtimezones(once, testOptions())).toBe(once);
  });

  test("ICAL-I30: a referenced identifier that resolves to nothing is left alone rather than invented", () => {
    const unknownZone = calendarWith([
      ...vevent({
        uid: "evt-1",
        lines: ["DTSTAMP:20260101T000000Z", "DTSTART;TZID=Middle-earth/Shire:20260310T090000"],
      }),
    ]);

    expect(synthesizeMissingVtimezones(unknownZone, testOptions())).toBe(unknownZone);
  });
});
