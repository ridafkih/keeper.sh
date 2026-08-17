import type { calendar_v3 } from "@googleapis/calendar";
import type {
  OccurrenceDuration,
  RecurrenceAnchor,
  RecurrencePayload,
  WithholdReason,
} from "@keeper.sh/sync-protocol";
import { decodeCalendarDate, decodeInstant, decodeZoneId } from "./event-time";

type DecodedRecurrence =
  | { readonly kind: "none" }
  | {
      readonly kind: "recurring";
      readonly payload: RecurrencePayload;
      readonly anchor: RecurrenceAnchor;
    }
  | { readonly kind: "undecodable"; readonly reason: WithholdReason };

const dayMs = 24 * 60 * 60 * 1000;

const linesOf = (item: calendar_v3.Schema$Event): readonly string[] =>
  (item.recurrence ?? []).filter((line) => typeof line === "string" && line.length > 0);

const exceptionProperties = ["EXDATE", "RDATE", "EXRULE"];

const isException = (line: string): boolean =>
  exceptionProperties.some((property) => line.startsWith(property));

const payloadOf = (lines: readonly string[]): RecurrencePayload | null => {
  const rule = lines.find((line) => !isException(line)) ?? null;
  if (rule === null) {
    return null;
  }
  return {
    dialect: "rfc5545",
    value: rule,
    exceptions: lines.filter((line) => isException(line)),
  };
};

const nominalDays = (from: string, until: string): number => {
  const span = Date.parse(`${until}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`);
  return Math.max(1, Math.round(span / dayMs));
};

const exactSeconds = (from: string, until: string): OccurrenceDuration => ({
  kind: "exact",
  seconds: Math.max(0, Math.round((Date.parse(until) - Date.parse(from)) / 1000)),
});

const anchorOf = (
  start: calendar_v3.Schema$EventDateTime | null | undefined,
  end: calendar_v3.Schema$EventDateTime | null | undefined,
): RecurrenceAnchor | null => {
  if (!start || !end) {
    return null;
  }
  const startDate = decodeCalendarDate(start.date);
  const endDate = decodeCalendarDate(end.date);
  if (startDate !== null && endDate !== null) {
    return {
      kind: "allDay",
      startDate,
      duration: { kind: "nominal", days: nominalDays(startDate.value, endDate.value) },
    };
  }
  const from = decodeInstant(start.dateTime);
  const until = decodeInstant(end.dateTime);
  const zone = decodeZoneId(start.timeZone);
  if (from === null || until === null || zone === null) {
    return null;
  }
  return { kind: "timed", start: from, zone, duration: exactSeconds(from.value, until.value) };
};

const decodeRecurrence = (item: calendar_v3.Schema$Event): DecodedRecurrence => {
  const lines = linesOf(item);
  if (lines.length === 0) {
    return { kind: "none" };
  }
  const payload = payloadOf(lines);
  if (payload === null) {
    return { kind: "undecodable", reason: "unsupportedRecurrenceRange" };
  }
  const anchor = anchorOf(item.start, item.end);
  if (anchor === null) {
    return { kind: "undecodable", reason: "unresolvableTimeZone" };
  }
  return { kind: "recurring", payload, anchor };
};

export { decodeRecurrence };
export type { DecodedRecurrence };
