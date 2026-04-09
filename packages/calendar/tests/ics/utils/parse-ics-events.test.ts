import { describe, expect, it } from "vitest";
import { parseIcsCalendar } from "../../../src/ics/utils/parse-ics-calendar";
import { parseIcsEvents } from "../../../src/ics/utils/parse-ics-events";

const createCalendarIcsString = (): string =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Keeper Test//EN",
    "BEGIN:VEVENT",
    "UID:external-event-1",
    "DTSTART;TZID=America/Toronto:20260310T090000",
    "DURATION:PT30M",
    "SUMMARY:Team Sync",
    "DESCRIPTION:Weekly planning",
    "LOCATION:Room 42",
    "RRULE:FREQ=WEEKLY;BYDAY=TU",
    "EXDATE;TZID=America/Toronto:20260317T090000",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:internal-event@keeper.sh",
    "DTSTART:20260311T100000Z",
    "DTEND:20260311T103000Z",
    "SUMMARY:Internal",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

describe("parseIcsEvents", () => {
  it("parses external events and skips keeper-managed events", () => {
    const calendar = parseIcsCalendar({ icsString: createCalendarIcsString() });
    const parsedEvents = parseIcsEvents(calendar);

    expect(parsedEvents).toHaveLength(1);

    const [parsedEvent] = parsedEvents;
    if (!parsedEvent) {
      throw new TypeError("Expected parsed event");
    }

    expect(parsedEvent.uid).toBe("external-event-1");
    expect(parsedEvent.title).toBe("Team Sync");
    expect(parsedEvent.description).toBe("Weekly planning");
    expect(parsedEvent.location).toBe("Room 42");
    expect(parsedEvent.startTimeZone).toBe("America/Toronto");
    expect(parsedEvent.endTime.getTime() - parsedEvent.startTime.getTime()).toBe(30 * 60 * 1000);

    const { recurrenceRule } = parsedEvent;
    expect(recurrenceRule).toBeDefined();
    if (!recurrenceRule || typeof recurrenceRule !== "object") {
      throw new TypeError("Expected recurrence rule object");
    }
    expect("frequency" in recurrenceRule && recurrenceRule.frequency).toBe("WEEKLY");

    const { exceptionDates } = parsedEvent;
    expect(exceptionDates).toBeDefined();
    expect(Array.isArray(exceptionDates)).toBe(true);
    if (!Array.isArray(exceptionDates)) {
      throw new TypeError("Expected exception dates array");
    }
    expect(exceptionDates).toHaveLength(1);
  });

  it("keeps duplicate UIDs and preserves adversarial time ranges", () => {
    const calendar = parseIcsCalendar({
      icsString: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Keeper Test//EN",
        "BEGIN:VEVENT",
        "UID:duplicate-uid",
        "DTSTART:20260310T090000Z",
        "DTEND:20260310T100000Z",
        "SUMMARY:First",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:duplicate-uid",
        "DTSTART:20991231T235900Z",
        "DTEND:19000101T000000Z",
        "SUMMARY:Second",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    });

    const parsedEvents = parseIcsEvents(calendar);

    expect(parsedEvents).toHaveLength(2);
    expect(parsedEvents[0]?.uid).toBe("duplicate-uid");
    expect(parsedEvents[1]?.uid).toBe("duplicate-uid");
    expect(parsedEvents[1]?.endTime.getTime()).toBeLessThan(
      parsedEvents[1]?.startTime.getTime() ?? Number.POSITIVE_INFINITY,
    );
  });
});
