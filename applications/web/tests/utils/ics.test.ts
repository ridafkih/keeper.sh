import { describe, expect, it } from "vitest";
import {
  buildIcsCalendar,
  formatIcsDateValue,
  icsFileName,
  parseIcsFile,
  validateIcsEventDraft,
  type IcsEventDraft,
} from "../../src/utils/ics";

const makeDraft = (overrides: Partial<IcsEventDraft> = {}): IcsEventDraft => ({
  summary: "Quarterly planning",
  description: "",
  location: "",
  allDay: false,
  start: "2026-08-20T09:00",
  end: "2026-08-20T10:30",
  ...overrides,
});

const options = { uid: "event-1@keeper.sh", stamp: new Date("2026-08-14T12:00:00.000Z") };

const propertyLines = (ics: string): string[] => ics.split("\r\n").filter(Boolean);

describe("validateIcsEventDraft", () => {
  it("accepts an event with a title and a range that moves forward", () => {
    expect(validateIcsEventDraft(makeDraft())).toEqual([]);
  });

  it("asks for the parts an event cannot be written without", () => {
    const errors = validateIcsEventDraft(makeDraft({ summary: "  ", start: "", end: "" }));
    expect(errors).toEqual([
      "Give the event a title.",
      "Pick a start date and time.",
      "Pick an end date and time.",
    ]);
  });

  it("rejects an end that does not come after the start", () => {
    expect(validateIcsEventDraft(makeDraft({ end: "2026-08-20T09:00" }))).toEqual([
      "The end time has to come after the start time.",
    ]);
  });

  it("lets an all-day event start and end on the same day", () => {
    const draft = makeDraft({ allDay: true, start: "2026-08-20", end: "2026-08-20" });
    expect(validateIcsEventDraft(draft)).toEqual([]);
    expect(validateIcsEventDraft({ ...draft, end: "2026-08-19" })).toEqual([
      "The end date cannot fall before the start date.",
    ]);
  });
});

describe("buildIcsCalendar", () => {
  it("wraps a single event in a calendar with the properties it was given", () => {
    const ics = buildIcsCalendar(
      makeDraft({ location: "Room 4", description: "Bring the roadmap" }),
      options,
    );

    expect(propertyLines(ics)).toEqual(expect.arrayContaining([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Keeper.sh//Keeper.sh ICS Generator//EN",
      "BEGIN:VEVENT",
      "UID:event-1@keeper.sh",
      "DTSTAMP:20260814T120000Z",
      "SUMMARY:Quarterly planning",
      "LOCATION:Room 4",
      "DESCRIPTION:Bring the roadmap",
      "END:VEVENT",
      "END:VCALENDAR",
    ]));
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("leaves out the properties the event has nothing for", () => {
    const ics = buildIcsCalendar(makeDraft(), options);
    expect(ics).not.toContain("LOCATION:");
    expect(ics).not.toContain("DESCRIPTION:");
  });

  it("writes the entered times as the instants they name", () => {
    const ics = buildIcsCalendar(makeDraft(), options);
    const start = propertyLines(ics).find((line) => line.startsWith("DTSTART:"));
    const expected = new Date("2026-08-20T09:00").toISOString().replace(/[-:]/g, "").slice(0, 15);
    expect(start).toBe(`DTSTART:${expected}Z`);
  });

  it("writes an all-day event as dates with an exclusive end", () => {
    const ics = buildIcsCalendar(
      makeDraft({ allDay: true, start: "2026-08-20", end: "2026-08-21" }),
      options,
    );
    expect(ics).toContain("DTSTART;VALUE=DATE:20260820\r\n");
    expect(ics).toContain("DTEND;VALUE=DATE:20260822\r\n");
  });

  it("escapes the characters the format reserves", () => {
    const ics = buildIcsCalendar(
      makeDraft({ summary: "Review; scope, plan\\draft", description: "First line\nSecond line" }),
      options,
    );
    expect(ics).toContain("SUMMARY:Review\\; scope\\, plan\\\\draft");
    expect(ics).toContain("DESCRIPTION:First line\\nSecond line");
  });

  it("folds lines longer than the format allows onto continuation lines", () => {
    const ics = buildIcsCalendar(makeDraft({ summary: "a".repeat(200) }), options);
    const lines = ics.split("\r\n");
    expect(lines.every((line) => line.length <= 75)).toBe(true);
    expect(lines.filter((line) => line.startsWith(" ")).length).toBeGreaterThan(0);
  });

  it("folds on octets rather than characters, so multi-byte titles stay within the limit", () => {
    const ics = buildIcsCalendar(makeDraft({ summary: "\u00e9".repeat(80) }), options);
    const lines = ics.split("\r\n");
    const octets = (line: string) => new TextEncoder().encode(line).length;

    expect(lines.every((line) => octets(line) <= 75)).toBe(true);
    expect(lines.some((line) => line.length < octets(line))).toBe(true);
  });

  it("never splits a character across two lines", () => {
    const ics = buildIcsCalendar(makeDraft({ summary: "\u{1f5d3}\u00e9".repeat(40) }), options);

    expect(ics.split("\r\n").join("").includes("\u{1f5d3}")).toBe(true);
  });

  it("refuses to write a calendar for an event that would not validate", () => {
    expect(() => buildIcsCalendar(makeDraft({ summary: "" }), options)).toThrow(/incomplete event/);
  });
});

describe("parseIcsFile", () => {
  it("reads a calendar back out of what the generator wrote", () => {
    const ics = buildIcsCalendar(
      makeDraft({ summary: "Review; scope", description: "First line\nSecond line", location: "Room 4" }),
      options,
    );
    const parsed = parseIcsFile(ics);

    expect(parsed.errors).toEqual([]);
    expect(parsed.productId).toBe("-//Keeper.sh//Keeper.sh ICS Generator//EN");
    expect(parsed.version).toBe("2.0");
    expect(parsed.events).toHaveLength(1);

    const [event] = parsed.events;
    expect(event.uid).toBe("event-1@keeper.sh");
    expect(event.summary).toBe("Review; scope");
    expect(event.description).toBe("First line\nSecond line");
    expect(event.location).toBe("Room 4");
    expect(event.start).toMatchObject({ isUtc: true, isDateOnly: false });
  });

  it("keeps the instant a round trip through the generator started from", () => {
    const ics = buildIcsCalendar(makeDraft(), options);
    const [event] = parseIcsFile(ics).events;
    const start = event.start!;
    const instant = Date.UTC(start.year, start.month - 1, start.day, start.hour, start.minute, start.second);

    expect(instant).toBe(new Date("2026-08-20T09:00").getTime());
  });

  it("joins folded lines back together", () => {
    const summary = "b".repeat(120);
    const ics = buildIcsCalendar(makeDraft({ summary }), options);
    const [event] = parseIcsFile(ics).events;

    expect(event.summary).toBe(summary);
  });

  it("keeps a reminder's own properties out of the event that contains it", () => {
    const parsed = parseIcsFile([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:real-event",
      "DTSTART:20260820T090000Z",
      "SUMMARY:Real event title",
      "DESCRIPTION:Real event description",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "UID:alarm-uid",
      "SUMMARY:Reminder headline",
      "DESCRIPTION:Reminder popup text",
      "TRIGGER:-PT10M",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n"));

    const [event] = parsed.events;

    expect(event.uid).toBe("real-event");
    expect(event.summary).toBe("Real event title");
    expect(event.description).toBe("Real event description");
  });

  it("reads the calendar name, several events, and the properties they carry", () => {
    const parsed = parseIcsFile([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "X-WR-CALNAME:Team calendar",
      "BEGIN:VTIMEZONE",
      "TZID:America/Toronto",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:one",
      "DTSTART;TZID=America/Toronto:20260820T090000",
      "DTEND;TZID=America/Toronto:20260820T100000",
      "SUMMARY:Standup",
      "ORGANIZER;CN=Ada Lovelace:mailto:ada@example.com",
      "STATUS:CONFIRMED",
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:two",
      "DTSTART;VALUE=DATE:20260901",
      "SUMMARY:Company holiday",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n"));

    expect(parsed.errors).toEqual([]);
    expect(parsed.calendarName).toBe("Team calendar");
    expect(parsed.events.map((event) => event.uid)).toEqual(["one", "two"]);

    const [standup, holiday] = parsed.events;
    expect(standup.organizer).toBe("Ada Lovelace");
    expect(standup.status).toBe("CONFIRMED");
    expect(standup.recurrenceRule).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(standup.start).toMatchObject({ timeZoneId: "America/Toronto", isUtc: false, hour: 9 });
    expect(holiday.start).toMatchObject({ isDateOnly: true, year: 2026, month: 9, day: 1 });
    expect(holiday.end).toBeNull();
  });

  it("falls back to the organizer address when no name is attached", () => {
    const parsed = parseIcsFile([
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:one",
      "ORGANIZER:mailto:ada@example.com",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n"));

    expect(parsed.events[0].organizer).toBe("ada@example.com");
  });

  it("accepts files that use bare newlines", () => {
    const parsed = parseIcsFile("BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:one\nEND:VEVENT\nEND:VCALENDAR");
    expect(parsed.events.map((event) => event.uid)).toEqual(["one"]);
  });

  it("says so when the text is not a calendar at all", () => {
    const parsed = parseIcsFile("just some notes");
    expect(parsed.events).toEqual([]);
    expect(parsed.errors).toEqual([
      "No BEGIN:VCALENDAR block was found, so this is not an ICS file.",
    ]);
  });
});

describe("formatIcsDateValue", () => {
  const [holiday] = parseIcsFile([
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "DTSTART;VALUE=DATE:20260901",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n")).events;

  const [zoned] = parseIcsFile([
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "DTSTART;TZID=America/Toronto:20260820T090000",
    "DTEND:20260820T140000Z",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n")).events;

  it("reads a date-only value as a whole day", () => {
    expect(formatIcsDateValue(holiday.start!)).toBe("September 1, 2026, all day");
  });

  it("shows a zoned value in the zone the file names", () => {
    expect(formatIcsDateValue(zoned.start!)).toBe("August 20, 2026 at 09:00, America/Toronto");
  });

  it("marks a UTC value as converted to the reader's own time", () => {
    expect(formatIcsDateValue(zoned.end!)).toContain(", your time");
  });

  it("reads an all-day event back out of the generator with the end date it was given", () => {
    const ics = buildIcsCalendar(
      makeDraft({ allDay: true, start: "2026-08-14", end: "2026-08-14" }),
      options,
    );
    const [event] = parseIcsFile(ics).events;

    expect(event.end!.raw).toBe("20260815");
    expect(formatIcsDateValue(event.start!)).toBe("August 14, 2026, all day");
    expect(formatIcsDateValue(event.end!, { exclusiveEnd: true })).toBe("August 14, 2026, all day");
  });

  it("keeps the last day of a multi-day all-day event on the day it covers", () => {
    const ics = buildIcsCalendar(
      makeDraft({ allDay: true, start: "2026-08-14", end: "2026-08-16" }),
      options,
    );
    const [event] = parseIcsFile(ics).events;

    expect(event.end!.raw).toBe("20260817");
    expect(formatIcsDateValue(event.end!, { exclusiveEnd: true })).toBe("August 16, 2026, all day");
  });

  it("leaves a date-time end alone, since only a date-only end is non-inclusive", () => {
    expect(formatIcsDateValue(zoned.end!, { exclusiveEnd: true })).toBe(
      formatIcsDateValue(zoned.end!),
    );
  });
});

describe("icsFileName", () => {
  it("names the file after the event", () => {
    expect(icsFileName("Quarterly planning")).toBe("quarterly-planning.ics");
    expect(icsFileName("Review; scope, plan")).toBe("review-scope-plan.ics");
  });

  it("falls back when the title leaves nothing to name it with", () => {
    expect(icsFileName("!!!")).toBe("event.ics");
  });
});
