import type { IcsExceptionDates, IcsRecurrenceRule } from "ts-ics";
import {
  parseStoredIcsExceptionDates,
  parseStoredIcsRecurrenceRule,
} from "../events/stored-recurrence";

interface StoredSourceEventState {
  availability?: string | null;
  description?: string | null;
  endTime: Date;
  exceptionDates: string | null;
  id: string;
  isAllDay?: boolean | null;
  location?: string | null;
  recurrenceId: Date | null;
  recurrenceRule: string | null;
  sourceEventId?: string | null;
  sourceEventInstanceKey: string | null;
  sourceEventType?: string | null;
  sourceEventUid: string | null;
  startTime: Date;
  startTimeZone: string | null;
  title?: string | null;
}

interface ExistingSourceEventState extends Omit<
  StoredSourceEventState,
  "exceptionDates" | "recurrenceRule"
> {
  exceptionDates: IcsExceptionDates | null;
  recurrenceRule: IcsRecurrenceRule | null;
}

interface StoredSourceEventParseFailure {
  error: Error;
  event: StoredSourceEventState;
  eventId: string;
}

interface StoredSourceEventParseResult {
  events: ExistingSourceEventState[];
  failures: StoredSourceEventParseFailure[];
}

const normalizeStoredSourceEventParseError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
};

const parseStoredSourceEventState = (
  event: StoredSourceEventState,
): ExistingSourceEventState => ({
  ...event,
  exceptionDates: parseStoredIcsExceptionDates(event.exceptionDates, event.id),
  recurrenceRule: parseStoredIcsRecurrenceRule(event.recurrenceRule, event.id),
});

const parseStoredSourceEventStates = (
  events: StoredSourceEventState[],
): ExistingSourceEventState[] => events.map((event) => parseStoredSourceEventState(event));

const parseStoredSourceEventStatesRecoveringInvalid = (
  storedEvents: StoredSourceEventState[],
): StoredSourceEventParseResult => {
  const events: ExistingSourceEventState[] = [];
  const failures: StoredSourceEventParseFailure[] = [];

  for (const storedEvent of storedEvents) {
    try {
      events.push(parseStoredSourceEventState(storedEvent));
    } catch (error) {
      failures.push({
        error: normalizeStoredSourceEventParseError(error),
        event: storedEvent,
        eventId: storedEvent.id,
      });
    }
  }

  return { events, failures };
};

export {
  parseStoredSourceEventState,
  parseStoredSourceEventStates,
  parseStoredSourceEventStatesRecoveringInvalid,
};
export type {
  ExistingSourceEventState,
  StoredSourceEventParseFailure,
  StoredSourceEventParseResult,
  StoredSourceEventState,
};
