import type { IcsRecurrenceRule } from "ts-ics";
import { visitIcsProperties } from "./apply-patches";
import { resolveTimeZone } from "./timezone-instant";

interface RecurrenceTimeZoneInput {
  recurrenceRule?: IcsRecurrenceRule;
  startTimeZone?: string;
}

const assertNoUnsupportedRecurrenceDates = (ical: string): void => {
  visitIcsProperties(ical, ({ componentPath, property }) => {
    if (componentPath.at(-1) === "VEVENT" && property === "RDATE") {
      throw new RangeError("ICS RDATE recurrence is not supported");
    }
  });
};

const assertSupportedRecurrenceTimeZones = (
  events: RecurrenceTimeZoneInput[],
): void => {
  for (const event of events) {
    if (event.recurrenceRule) {
      resolveTimeZone(event.startTimeZone);
    }
  }
};

export { assertNoUnsupportedRecurrenceDates, assertSupportedRecurrenceTimeZones };
