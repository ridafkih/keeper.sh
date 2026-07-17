import type { IcsRecurrenceRule } from "ts-ics";
import { resolveTimeZone } from "./timezone-instant";

interface RecurrenceTimeZoneInput {
  recurrenceRule?: IcsRecurrenceRule;
  startTimeZone?: string;
}

const assertNoUnsupportedRecurrenceDates = (ical: string): void => {
  const unfolded = ical.replaceAll(/\r?\n[\t ]/g, "");
  let insideEvent = false;
  for (const line of unfolded.split(/\r?\n/)) {
    const normalizedLine = line.toUpperCase();
    if (normalizedLine === "BEGIN:VEVENT") {
      insideEvent = true;
      continue;
    }
    if (normalizedLine === "END:VEVENT") {
      insideEvent = false;
      continue;
    }
    if (!insideEvent) {
      continue;
    }
    const [propertyName] = normalizedLine.split(/[:;]/, 1);
    if (propertyName === "RDATE") {
      throw new RangeError("ICS RDATE recurrence is not supported");
    }
  }
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
