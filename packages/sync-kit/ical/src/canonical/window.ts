import type { EventTime, TimeWindow, WindowMembership } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";

interface Span {
  readonly startMs: number;
  readonly endMs: number;
}

const spanOf = (time: EventTime): Span => {
  switch (time.kind) {
    case "timed": {
      return { startMs: Date.parse(time.start.value), endMs: Date.parse(time.end.value) };
    }
    case "allDay": {
      return {
        startMs: Date.parse(`${time.startDate.value}T00:00:00.000Z`),
        endMs: Date.parse(`${time.endDateExclusive.value}T00:00:00.000Z`),
      };
    }
    default: {
      return assertNever(time);
    }
  }
};

const withinTimeWindow = ((window: TimeWindow, time: EventTime): boolean => {
  const span = spanOf(time);
  return span.startMs < Date.parse(window.end.value) && span.endMs >= Date.parse(window.start.value);
}) satisfies WindowMembership;

export { withinTimeWindow };
