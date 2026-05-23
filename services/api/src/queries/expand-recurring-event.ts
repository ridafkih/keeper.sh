import { extendByRecurrenceRule } from "ts-ics";

import {
  parseExceptionDatesFromJson,
  parseRecurrenceRuleFromJson,
} from "@keeper.sh/calendar";

interface RecurringEventRow {
  id: string;
  calendarId: string;
  startTime: Date;
  endTime: Date;
  recurrenceRule: string | null;
  exceptionDates: string | null;
  title: string | null;
  description: string | null;
  location: string | null;
}

interface RecurringOccurrence {
  id: string;
  calendarId: string;
  startTime: Date;
  endTime: Date;
  title: string | null;
  description: string | null;
  location: string | null;
}

const MS_OFFSET_NONE = 0;

const buildOccurrenceId = (masterId: string, occurrenceStart: Date): string =>
  `${masterId}_${occurrenceStart.toISOString()}`;

const isWithinInclusive = (date: Date, start: Date, end: Date): boolean =>
  date >= start && date <= end;

/**
 * Materialise recurring-event occurrences that fall inside [windowStart,
 * windowEnd]. The master row stores the first occurrence's start/end plus the
 * serialised RRULE / EXDATE; we use `ts-ics`'s `extendByRecurrenceRule` to
 * generate every concrete occurrence within the window, honouring exception
 * dates and the rule's `until` / `count` terminators.
 *
 * Each occurrence inherits the master's duration. RECURRENCE-ID overrides
 * (per-instance edits/cancellations beyond plain EXDATE) are not yet
 * persisted by the ingest path and are therefore not honoured here.
 *
 * When the RRULE is missing or unparseable, only the master row is returned,
 * and only if it lies within the window.
 */
const expandRecurringEvent = (
  row: RecurringEventRow,
  windowStart: Date,
  windowEnd: Date,
): RecurringOccurrence[] => {
  const rule = parseRecurrenceRuleFromJson(row.recurrenceRule);
  if (!rule) {
    if (isWithinInclusive(row.startTime, windowStart, windowEnd)) {
      return [
        {
          id: row.id,
          calendarId: row.calendarId,
          startTime: row.startTime,
          endTime: row.endTime,
          title: row.title,
          description: row.description,
          location: row.location,
        },
      ];
    }
    return [];
  }

  const exceptions = parseExceptionDatesFromJson(row.exceptionDates);
  const durationMs = Math.max(
    row.endTime.getTime() - row.startTime.getTime(),
    MS_OFFSET_NONE,
  );

  const dates = extendByRecurrenceRule(rule, {
    start: row.startTime,
    end: windowEnd,
    exceptions,
  });

  const occurrences: RecurringOccurrence[] = [];
  for (const occurrenceStart of dates) {
    if (!isWithinInclusive(occurrenceStart, windowStart, windowEnd)) {
      continue;
    }
    occurrences.push({
      id: buildOccurrenceId(row.id, occurrenceStart),
      calendarId: row.calendarId,
      startTime: occurrenceStart,
      endTime: new Date(occurrenceStart.getTime() + durationMs),
      title: row.title,
      description: row.description,
      location: row.location,
    });
  }
  return occurrences;
};

export { expandRecurringEvent };
export type { RecurringEventRow, RecurringOccurrence };
