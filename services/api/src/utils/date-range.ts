import { MS_PER_WEEK } from "@keeper.sh/constants";

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
const normalizeDateRange = (from: Date, to: Date): NormalizedDateRange => ({
  start: new Date(from),
  end: new Date(to),
});

export { parseDateRangeParams, normalizeDateRange };
export type { DateRange, NormalizedDateRange };
