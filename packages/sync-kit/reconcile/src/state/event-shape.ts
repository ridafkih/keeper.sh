import type { EventTime, Instant, RecurrenceAnchor, RemoteEvent } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";

const startOfDay = (day: string): Instant => ({ kind: "instant", value: `${day}T00:00:00.000Z` });

const boundsOfTime = (time: EventTime): { readonly start: Instant; readonly end: Instant } => {
  switch (time.kind) {
    case "timed": {
      return { start: time.start, end: time.end };
    }
    case "allDay": {
      return {
        start: startOfDay(time.startDate.value),
        end: startOfDay(time.endDateExclusive.value),
      };
    }
    default: {
      return assertNever(time);
    }
  }
};

const anchorStartOf = (anchor: RecurrenceAnchor): Instant => {
  switch (anchor.kind) {
    case "timed": {
      return anchor.start;
    }
    case "allDay": {
      return startOfDay(anchor.startDate.value);
    }
    default: {
      return assertNever(anchor);
    }
  }
};

const startInstantOf = (event: RemoteEvent): Instant => {
  if (event.content.recurrence) {
    return anchorStartOf(event.content.anchor);
  }
  return boundsOfTime(event.content.time).start;
};

const isRecurring = (event: RemoteEvent): boolean => Boolean(event.content.recurrence);

const timeShapes = ["recurring", "timed", "allDay"] as const;
type TimeShape = (typeof timeShapes)[number];

const timeShapeOf = (event: RemoteEvent): TimeShape => {
  if (event.content.recurrence) {
    return "recurring";
  }
  return event.content.time.kind;
};

export { boundsOfTime, isRecurring, startInstantOf, timeShapeOf, timeShapes };
export type { TimeShape };
