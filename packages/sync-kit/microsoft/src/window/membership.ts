import type { EventTime, TimeWindow, WindowMembership } from "@keeper.sh/sync-protocol";

interface Span {
  readonly from: number;
  readonly until: number;
}

const midnightMs = (date: string): number => Date.parse(`${date}T00:00:00.000Z`);

const spanOf = (time: EventTime): Span => {
  if (time.kind === "allDay") {
    return {
      from: midnightMs(time.startDate.value),
      until: midnightMs(time.endDateExclusive.value),
    };
  }
  return { from: Date.parse(time.start.value), until: Date.parse(time.end.value) };
};

const boundsOf = (bounds: TimeWindow): Span => ({
  from: Date.parse(bounds.start.value),
  until: Date.parse(bounds.end.value),
});

const namesOneInstant = (span: Span): boolean => !(span.until > span.from);

const withinMicrosoftWindow: WindowMembership = (bounds, time) => {
  const admitted = boundsOf(bounds);
  const span = spanOf(time);
  if (namesOneInstant(span)) {
    return span.from >= admitted.from && span.from < admitted.until;
  }
  return span.from < admitted.until && span.until > admitted.from;
};

export { withinMicrosoftWindow };
