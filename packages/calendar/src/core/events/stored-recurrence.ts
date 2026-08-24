import {
  icsExceptionDatesSchema,
  storedIcsRecurrenceRuleSchema,
} from "@keeper.sh/data-schemas";
import type { IcsDuration, IcsExceptionDates, IcsRecurrenceRule } from "ts-ics";
import { getErrorMessage } from "../utils/error";

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

interface ParsedStoredRecurrenceRule {
  recurrenceDuration?: IcsDuration;
  recurrenceRule: IcsRecurrenceRule;
}

const parseStoredIcsRecurrence = (
  value: string | null,
  eventId: string,
): ParsedStoredRecurrenceRule | null => {
  if (value === null) {
    return null;
  }

  const parsed = parseStoredJson(value, "recurrenceRule", eventId);

  try {
    const storedRule = storedIcsRecurrenceRuleSchema.assert(parsed);
    const { recurrenceDuration, ...recurrenceRule } = storedRule;
    return { recurrenceDuration, recurrenceRule };
  } catch (error) {
    throw new TypeError(
      `Invalid recurrenceRule shape for event ${eventId}: ${getErrorMessage(error)}`,
      { cause: error },
    );
  }
};

const parseStoredIcsRecurrenceRule = (
  value: string | null,
  eventId: string,
): IcsRecurrenceRule | null =>
  parseStoredIcsRecurrence(value, eventId)?.recurrenceRule ?? null;

const serializeStoredIcsRecurrenceRule = (
  recurrenceRule: IcsRecurrenceRule | undefined,
  recurrenceDuration: IcsDuration | undefined,
): string | null => {
  if (!recurrenceRule) {
    return null;
  }
  return JSON.stringify({
    ...recurrenceRule,
    ...(recurrenceDuration && { recurrenceDuration }),
  });
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
    throw new TypeError(
      `Invalid exceptionDates shape for event ${eventId}: ${getErrorMessage(error)}`,
      { cause: error },
    );
  }
};

interface StoredRecurrenceMaterializationInput {
  eventId: string;
  exceptionDates: string | null;
  recurrenceId: Date | null;
  recurrenceRule: string | null;
}

interface MaterializedRecurrenceFields {
  exceptionDates?: Date[];
  recurrenceDuration?: IcsDuration;
  recurrenceId?: Date;
  recurrenceRule?: IcsRecurrenceRule;
}

const parseStoredRecurrenceForMaterialization = (
  input: StoredRecurrenceMaterializationInput,
): MaterializedRecurrenceFields => {
  const exceptionDates = parseStoredIcsExceptionDates(
    input.exceptionDates,
    input.eventId,
  )?.map((exceptionDate) => exceptionDate.date);
  const storedRecurrenceRule = parseStoredIcsRecurrence(
    input.recurrenceRule,
    input.eventId,
  );

  return {
    ...(exceptionDates && { exceptionDates }),
    ...(input.recurrenceId && { recurrenceId: input.recurrenceId }),
    ...(storedRecurrenceRule && {
      ...(storedRecurrenceRule.recurrenceDuration && {
        recurrenceDuration: storedRecurrenceRule.recurrenceDuration,
      }),
      recurrenceRule: storedRecurrenceRule.recurrenceRule,
    }),
  };
};

export {
  parseStoredIcsExceptionDates,
  parseStoredIcsRecurrence,
  parseStoredIcsRecurrenceRule,
  parseStoredRecurrenceForMaterialization,
  serializeStoredIcsRecurrenceRule,
};
export type {
  MaterializedRecurrenceFields,
  ParsedStoredRecurrenceRule,
  StoredRecurrenceMaterializationInput,
};
