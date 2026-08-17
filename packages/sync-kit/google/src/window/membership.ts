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

const withinGoogleWindow: WindowMembership = (bounds, time) => {
  const window = boundsOf(bounds);
  const span = spanOf(time);
  if (namesOneInstant(span)) {
    return span.from >= window.from && span.from < window.until;
  }
  return span.from < window.until && span.until > window.from;
};

export { withinGoogleWindow };
