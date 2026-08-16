import { describe, expect, it } from "vitest";
import { extractProperties, patchIcsEvent } from
  "../../../../src/providers/caldav/source/patch-ics";

const UID = "source-event-uid-1";

const buildObject = (lines: string[]): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Some Other Client//EN",
  "BEGIN:VEVENT",
  `UID:${UID}`,
  ...lines,
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const ALARM_LINES = [
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "TRIGGER:-PT15M",
  "DESCRIPTION:Quarterly review starts soon",
  "DURATION:PT5M",
  "REPEAT:2",
  "END:VALARM",
];

const ORIGINAL = buildObject([
  "DTSTAMP:20270501T120000Z",
  "DTSTART:20270511T140000Z",
  "DTEND:20270511T150000Z",
  "SUMMARY:Quarterly review",
  "DESCRIPTION:Bring the deck",
  ...ALARM_LINES,
]);

const patch = (
  rendered: string,
  propertyNames: Set<string>,
): string[] => {
  const patched = patchIcsEvent({
    ics: ORIGINAL,
    properties: extractProperties(rendered, propertyNames),
    propertyNames,
    uid: UID,
  });
  if (patched === null) {
    throw new Error("Expected the event to be located inside the object");
  }
  return patched.split("\r\n");
};

const readAlarmBlock = (lines: string[]): string[] => {
  const start = lines.indexOf("BEGIN:VALARM");
  const end = lines.indexOf("END:VALARM");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return lines.slice(start, end + 1);
};

describe("a CalDAV write-back leaves the event's alarms alone", () => {
  it("keeps the alarm's DESCRIPTION when the event description is rewritten", () => {
    const rendered = buildObject([
      "DTSTAMP:20270501T130000Z",
      "DTSTART:20270511T140000Z",
      "DTEND:20270511T150000Z",
      "SUMMARY:Quarterly review",
      "DESCRIPTION:Bring the revised deck",
    ]);

    const lines = patch(rendered, new Set(["DTSTAMP", "DESCRIPTION"]));

    expect(readAlarmBlock(lines)).toEqual(ALARM_LINES);
    expect(lines).toContain("DESCRIPTION:Bring the revised deck");
  });

  it("keeps the alarm's DURATION out of the event body when the schedule moves", () => {
    const rendered = buildObject([
      "DTSTAMP:20270501T130000Z",
      "DTSTART:20270511T170000Z",
      "DTEND:20270511T180000Z",
      "SUMMARY:Quarterly review",
      "DESCRIPTION:Bring the deck",
    ]);

    const lines = patch(
      rendered,
      new Set(["DTSTAMP", "DTSTART", "DTEND", "DURATION"]),
    );

    expect(readAlarmBlock(lines)).toEqual(ALARM_LINES);
    const body = lines.slice(0, lines.indexOf("BEGIN:VALARM"));
    expect(body).not.toContain("DURATION:PT5M");
  });

  it("does not delete an alarm's only DESCRIPTION off an event that has none", () => {
    const bare = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      `UID:${UID}`,
      "DTSTAMP:20270501T120000Z",
      "DTSTART:20270511T140000Z",
      "DTEND:20270511T150000Z",
      "SUMMARY:Quarterly review",
      ...ALARM_LINES,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const propertyNames = new Set(["DTSTAMP", "DESCRIPTION"]);
    const rendered = buildObject([
      "DTSTAMP:20270501T130000Z",
      "DTSTART:20270511T140000Z",
      "DTEND:20270511T150000Z",
      "SUMMARY:Quarterly review",
      "DESCRIPTION:Added on the destination",
    ]);

    const patched = patchIcsEvent({
      ics: bare,
      properties: extractProperties(rendered, propertyNames),
      propertyNames,
      uid: UID,
    });
    if (patched === null) {
      throw new Error("Expected the event to be located inside the object");
    }

    const lines = patched.split("\r\n");
    expect(readAlarmBlock(lines)).toEqual(ALARM_LINES);
    expect(lines.slice(0, lines.indexOf("BEGIN:VALARM")))
      .toContain("DESCRIPTION:Added on the destination");
  });
});
