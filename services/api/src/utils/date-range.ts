import { MS_PER_WEEK } from "@keeper.sh/constants";

const HOURS_START_OF_DAY = 0;
const MINUTES_START = 0;
const SECONDS_START = 0;
const MILLISECONDS_START = 0;
const HOURS_END_OF_DAY = 23;
const MINUTES_END = 59;
const SECONDS_END = 59;
const MILLISECONDS_END = 999;

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

const normalizeDateRange = (from: Date, to: Date): NormalizedDateRange => {
  const start = new Date(from);
  start.setHours(HOURS_START_OF_DAY, MINUTES_START, SECONDS_START, MILLISECONDS_START);

  const end = new Date(to);
  end.setHours(HOURS_END_OF_DAY, MINUTES_END, SECONDS_END, MILLISECONDS_END);

  return { end, start };
};

export { parseDateRangeParams, normalizeDateRange };
export type { DateRange, NormalizedDateRange };
