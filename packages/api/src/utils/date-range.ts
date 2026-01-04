import { MS_PER_WEEK } from "@keeper.sh/constants";

interface DateRange {
  from: Date;
  to: Date;
}

interface NormalizedDateRange {
  start: Date;
  end: Date;
}

/**
 * Parses date range query parameters from a URL.
 * Defaults to today -> 7 days from now if not provided.
 */
export const parseDateRangeParams = (url: URL): DateRange => {
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  const now = new Date();
  const from = fromParam ? new Date(fromParam) : now;
  const to = toParam
    ? new Date(toParam)
    : new Date(from.getTime() + MS_PER_WEEK);

  return { from, to };
};

/**
 * Normalizes a date range to start of day and end of day.
 */
export const normalizeDateRange = (
  from: Date,
  to: Date,
): NormalizedDateRange => {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);

  const end = new Date(to);
  end.setHours(23, 59, 59, 999);

  return { start, end };
};
