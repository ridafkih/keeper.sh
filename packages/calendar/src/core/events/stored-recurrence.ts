import {
  icsExceptionDatesSchema,
  icsRecurrenceRuleSchema,
} from "@keeper.sh/data-schemas";
import type { IcsExceptionDates, IcsRecurrenceRule } from "ts-ics";

const parseStoredJson = (
  value: string,
  field: "exceptionDates" | "recurrenceRule",
  eventId: string,
): unknown => {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Failed to JSON.parse ${field} for event ${eventId}`, { cause: error });
  }
};

const parseStoredIcsRecurrenceRule = (
  value: string | null,
  eventId: string,
): IcsRecurrenceRule | null => {
  if (value === null) {
    return null;
  }

  const parsed = parseStoredJson(value, "recurrenceRule", eventId);

  try {
    return icsRecurrenceRuleSchema.assert(parsed);
  } catch (error) {
    throw new TypeError(`Invalid recurrenceRule shape for event ${eventId}`, { cause: error });
  }
};

const parseStoredIcsExceptionDates = (
  value: string | null,
  eventId: string,
): IcsExceptionDates | null => {
  if (value === null) {
    return null;
  }

  const parsed = parseStoredJson(value, "exceptionDates", eventId);

  try {
    return icsExceptionDatesSchema.assert(parsed);
  } catch (error) {
    throw new TypeError(`Invalid exceptionDates shape for event ${eventId}`, { cause: error });
  }
};

export { parseStoredIcsExceptionDates, parseStoredIcsRecurrenceRule };
