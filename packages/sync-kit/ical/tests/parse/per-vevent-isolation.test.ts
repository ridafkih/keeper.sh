import { describe, expect, test } from "vitest";
import { parseIcsDocument, parseVevent, projectIcsFeed } from "../../src/index";
import { calendarWith, simpleEvent, testScope, vevent } from "../support/feed";
import { testOptions } from "../support/options";

const malformedShapes = [
  {
    name: "a VEVENT with no UID",
    lines: vevent({ uid: "", lines: ["DTSTAMP:20260310T080000Z", "DTSTART:20260310T090000Z"] }).filter(
      (line) => line !== "UID:",
    ),
  },
  {
    name: "a VEVENT with no DTSTART",
    lines: vevent({ uid: "evt-no-start", lines: ["DTSTAMP:20260310T080000Z", "SUMMARY:x"] }),
  },
  {
    name: "an all-day VEVENT declaring an hour-based DURATION",
    lines: vevent({
      uid: "evt-hour-all-day",
      lines: [
        "DTSTAMP:20260310T080000Z",
        "DTSTART;VALUE=DATE:20260310",
        "DURATION:PT1H",
        "SUMMARY:x",
      ],
    }),
  },
  {
    name: "a VEVENT with an unresolvable TZID",
    lines: vevent({
      uid: "evt-bad-zone",
      lines: [
        "DTSTAMP:20260310T080000Z",
        "DTSTART;TZID=Middle-earth/Shire:20260310T090000",
        "DTEND;TZID=Middle-earth/Shire:20260310T100000",
        "SUMMARY:x",
      ],
    }),
  },
] as const;

describe("one VEVENT the parser cannot build", () => {
  for (const shape of malformedShapes) {
    test(`ICAL-I2: ${shape.name} never fails the whole feed`, () => {
      const projection = projectIcsFeed({
        body: calendarWith([
          ...simpleEvent("evt-healthy", "20260310T090000Z", "20260310T100000Z"),
          ...shape.lines,
        ]),
        scope: testScope,
        previousContentHash: null,
        options: testOptions(),
      });

      expect(projection.ok).toBe(true);
      if (!projection.ok) {
        return;
      }
      expect(projection.value.usable.map((identity) => identity.uid.value)).toEqual(["evt-healthy"]);
      expect(projection.value.unsupported).toHaveLength(1);
    });
  }

  test("ICAL-I2: parseVevent is total and has no throw path", () => {
    const body = calendarWith(malformedShapes.flatMap((shape) => [...shape.lines]));
    const options = testOptions();
    const document = parseIcsDocument(body, options);

    expect(document.kind).toBe("readable");
    if (document.kind !== "readable") {
      return;
    }
    for (const component of document.components) {
      expect(() => parseVevent(component, document, options)).not.toThrow();
    }
  });
});
