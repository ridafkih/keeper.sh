import { describe, expect, it } from "vitest";
import { parseOutlookEvents } from "../../../../../src/providers/outlook/source/utils/fetch-events";
import type { OutlookCalendarEvent } from "../../../../../src/providers/outlook/source/types";

const createOutlookEvent = (showAs: string): OutlookCalendarEvent => ({
  end: {
    dateTime: "2026-03-08T15:00:00",
    timeZone: "UTC",
  },
  iCalUId: "external-uid-1",
  id: "outlook-event-id-1",
  showAs,
  start: {
    dateTime: "2026-03-08T14:00:00",
    timeZone: "UTC",
  },
  subject: "Outlook Planning",
});

describe("parseOutlookEvents tentative classification", () => {
  it("classifies a tentative event while still storing it as busy", () => {
    const [parsedEvent] = parseOutlookEvents([createOutlookEvent("tentative")]);

    expect(parsedEvent?.availability).toBe("busy");
    expect(parsedEvent?.sourceEventType).toBe("tentative");
  });

  it.each(["busy", "free", "oof", "workingElsewhere"])(
    "leaves a %s event unclassified",
    (showAs) => {
      const [parsedEvent] = parseOutlookEvents([createOutlookEvent(showAs)]);

      expect(parsedEvent).not.toHaveProperty("sourceEventType");
    },
  );
});
