import { describe, expect, it } from "vitest";
import { parseIcsCalendar } from "../../../src/ics/utils/parse-ics-calendar";
import { parseIcsEvents } from "../../../src/ics/utils/parse-ics-events";

const parseEventWithLines = (lines: string[]) => {
  const calendar = parseIcsCalendar({
    icsString: [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Keeper Test//EN",
      "BEGIN:VEVENT",
      "UID:outlook-published-event",
      "DTSTART:20260310T140000Z",
      "DTEND:20260310T143000Z",
      "SUMMARY:Planning",
      ...lines,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n"),
  });
  const [parsedEvent] = parseIcsEvents(calendar);
  if (!parsedEvent) {
    throw new TypeError("Expected parsed event");
  }
  return parsedEvent;
};

describe("parseIcsEvents Outlook busy status", () => {
  it("classifies a tentative event while still reading it as busy", () => {
    const parsedEvent = parseEventWithLines([
      "TRANSP:OPAQUE",
      "X-MICROSOFT-CDO-BUSYSTATUS:TENTATIVE",
    ]);

    expect(parsedEvent.availability).toBe("busy");
    expect(parsedEvent.sourceEventType).toBe("tentative");
  });

  it("matches the tentative status regardless of case", () => {
    const parsedEvent = parseEventWithLines(["X-MICROSOFT-CDO-BUSYSTATUS:Tentative"]);

    expect(parsedEvent.sourceEventType).toBe("tentative");
  });

  it("leaves other busy statuses unclassified", () => {
    const parsedEvent = parseEventWithLines([
      "TRANSP:OPAQUE",
      "X-MICROSOFT-CDO-BUSYSTATUS:BUSY",
    ]);

    expect(parsedEvent).not.toHaveProperty("sourceEventType");
  });

  it("leaves events without the header unclassified", () => {
    const parsedEvent = parseEventWithLines(["TRANSP:OPAQUE"]);

    expect(parsedEvent).not.toHaveProperty("sourceEventType");
  });

  it("classifies a standard tentative status when the Outlook header is absent", () => {
    const parsedEvent = parseEventWithLines(["STATUS:TENTATIVE"]);

    expect(parsedEvent.sourceEventType).toBe("tentative");
  });

  it("lets the Outlook busy status win over a tentative event status", () => {
    const parsedEvent = parseEventWithLines([
      "STATUS:TENTATIVE",
      "X-MICROSOFT-CDO-BUSYSTATUS:BUSY",
    ]);

    expect(parsedEvent).not.toHaveProperty("sourceEventType");
  });

  it("leaves confirmed events unclassified", () => {
    const parsedEvent = parseEventWithLines(["STATUS:CONFIRMED"]);

    expect(parsedEvent).not.toHaveProperty("sourceEventType");
  });
});
