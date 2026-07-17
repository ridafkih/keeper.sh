import type { IcsExceptionDates, IcsRecurrenceRule } from "ts-ics";
import {
  parseStoredIcsExceptionDates,
  parseStoredIcsRecurrenceRule,
} from "../events/stored-recurrence";
import type { SourceEvent } from "../types";
import { buildSourceEventInstanceKey } from "./event-instance";

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

const buildInvalidStoredEventIdsToRemove = (
  failures: StoredSourceEventParseFailure[],
  incomingEvents: SourceEvent[],
): string[] => {
  const incomingProviderIds = new Set<string>();
  const incomingFallbackKeys = new Set<string>();
  for (const event of incomingEvents) {
    if (event.sourceEventId) {
      incomingProviderIds.add(event.sourceEventId);
      continue;
    }
    incomingFallbackKeys.add(buildSourceEventInstanceKey(event));
  }

  return failures.flatMap(({ event, eventId }) => {
    if (event.sourceEventId) {
      if (incomingProviderIds.has(event.sourceEventId)) {
        return [];
      }
      return [eventId];
    }

    if (event.sourceEventUid === null) {
      return [eventId];
    }

    const instanceKey = buildSourceEventInstanceKey({
      endTime: event.endTime,
      recurrenceId: event.recurrenceId,
      startTime: event.startTime,
      uid: event.sourceEventUid,
    });
    if (incomingFallbackKeys.has(instanceKey)) {
      return [];
    }
    return [eventId];
  });
};

export {
  buildInvalidStoredEventIdsToRemove,
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
