import { MS_PER_DAY, MS_PER_WEEK } from "@keeper.sh/constants";

const MAX_EVENT_RANGE_DAYS = 732;
const MAX_EVENT_RANGE_MS = MAX_EVENT_RANGE_DAYS * MS_PER_DAY;

class EventRangeValidationError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "EventRangeValidationError";
  }
}

interface DateRange {
  from: Date;
  to: Date;
}

interface NormalizedDateRange {
  start: Date;
  end: Date;
}

const parseFromParam = (fromParam: string | null, fallback: Date): Date => {
  if (fromParam) {
    return new Date(fromParam);
  }
  return fallback;
};

const parseToParam = (toParam: string | null, from: Date): Date => {
  if (toParam) {
    return new Date(toParam);
  }
  return new Date(from.getTime() + MS_PER_WEEK);
};

const parseDateRangeParams = (url: URL): DateRange => {
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  const now = new Date();
  const from = parseFromParam(fromParam, now);
  const to = parseToParam(toParam, from);

  return { from, to };
};

/**
 * Honour the exact instants supplied by the caller. Previously this snapped
 * `from` to start-of-day and `to` to end-of-day in server-local time, which
 * silently widened queries whose bounds carried a meaningful time component
 * (e.g. MCP callers passing precise UTC instants). The web frontend already
 * supplies day-shaped bounds (see hooks/use-events.ts), so removing the
 * snap is a no-op for it.
 */
const normalizeDateRange = (from: Date, to: Date): NormalizedDateRange => {
  const start = new Date(from);
  const end = new Date(to);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new EventRangeValidationError("Event range requires valid from and to dates");
  }
  if (start >= end) {
    throw new EventRangeValidationError("Event range requires from to be before to");
  }
  if (end.getTime() - start.getTime() > MAX_EVENT_RANGE_MS) {
    throw new EventRangeValidationError(
      `Event range cannot exceed ${MAX_EVENT_RANGE_DAYS} days`,
    );
  }

  return { start, end };
};

export { EventRangeValidationError, parseDateRangeParams, normalizeDateRange };
export type { DateRange, NormalizedDateRange };
