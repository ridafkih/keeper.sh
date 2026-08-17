import type {
  EventTime,
  RecurrenceAnchor,
  RecurrencePayload,
  RecurrenceDialect,
} from "@keeper.sh/sync-protocol";
import { assertNever, recurrenceDialects } from "@keeper.sh/sync-protocol";
import type { Event as GraphEvent } from "@microsoft/microsoft-graph-types";
import { extendedPropertyValue, recurrencePropertyName } from "./extended-property";
import { utcZone } from "./zone";

interface RecurrenceReading {
  readonly payload: RecurrencePayload;
  readonly anchor: RecurrenceAnchor;
}

type RecurrenceOutcome =
  | { readonly kind: "recurring"; readonly reading: RecurrenceReading }
  | { readonly kind: "single" }
  | { readonly kind: "unrepresentable" };

const dayMs = 24 * 60 * 60 * 1000;
const millisecondsInSecond = 1000;

const parsedJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const dialectOf = (value: unknown): RecurrenceDialect | null =>
  recurrenceDialects.find((dialect) => dialect === value) ?? null;

const exceptionsOf = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry) => typeof entry === "string");
};

const storedPayload = (event: GraphEvent): RecurrencePayload | null => {
  const stored = extendedPropertyValue(event, recurrencePropertyName);
  if (stored === null) {
    return null;
  }
  const carrier = parsedJson(stored);
  if (typeof carrier !== "object" || carrier === null) {
    return null;
  }
  const fields: Record<string, unknown> = { ...carrier };
  const dialect = dialectOf(fields.dialect);
  if (dialect === null || typeof fields.value !== "string") {
    return null;
  }
  return { dialect, value: fields.value, exceptions: exceptionsOf(fields.exceptions) };
};

const patternedPayload = (event: GraphEvent): RecurrencePayload | null => {
  const { recurrence } = event;
  if (!recurrence) {
    return null;
  }
  return {
    dialect: "providerNative",
    value: JSON.stringify({ pattern: recurrence.pattern ?? null, range: recurrence.range ?? null }),
    exceptions: [],
  };
};

const nominalDays = (time: Extract<EventTime, { kind: "allDay" }>): number => {
  const from = Date.parse(`${time.startDate.value}T00:00:00.000Z`);
  const until = Date.parse(`${time.endDateExclusive.value}T00:00:00.000Z`);
  return Math.max(1, Math.round((until - from) / dayMs));
};

const anchorOf = (time: EventTime): RecurrenceAnchor => {
  switch (time.kind) {
    case "allDay": {
      return {
        kind: "allDay",
        startDate: time.startDate,
        duration: { kind: "nominal", days: nominalDays(time) },
      };
    }
    case "timed": {
      return {
        kind: "timed",
        start: time.start,
        zone: time.zone ?? utcZone,
        duration: {
          kind: "exact",
          seconds: Math.max(
            0,
            Math.round((Date.parse(time.end.value) - Date.parse(time.start.value)) / millisecondsInSecond),
          ),
        },
      };
    }
    default: {
      return assertNever(time);
    }
  }
};

const readRecurrence = (event: GraphEvent, time: EventTime | null): RecurrenceOutcome => {
  const payload = storedPayload(event) ?? patternedPayload(event);
  if (payload === null) {
    return { kind: "single" };
  }
  if (time === null) {
    return { kind: "unrepresentable" };
  }
  return { kind: "recurring", reading: { payload, anchor: anchorOf(time) } };
};

export { readRecurrence };
export type { RecurrenceOutcome, RecurrenceReading };
