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

export { parseStoredSourceEventState, parseStoredSourceEventStates };
export type { ExistingSourceEventState, StoredSourceEventState };
