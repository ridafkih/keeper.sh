import { MS_PER_DAY, MS_PER_MINUTE } from "@keeper.sh/constants";

interface EventTimeRange {
  startTime: Date;
  endTime: Date;
}

/*
 * An all-day range carries an exclusive end date, so anything shorter than a day names
 * the single day it starts on — the reading RFC 5545 §3.6.1 gives a DATE-valued DTSTART
 * with no DTEND. Destinations that require whole days cannot take the shorter form.
 */
const resolveWholeDayTimeRange = ({ endTime, startTime }: EventTimeRange): EventTimeRange => {
  if (endTime.getTime() - startTime.getTime() >= MS_PER_DAY) {
    return { endTime, startTime };
  }

  return { endTime: new Date(startTime.getTime() + MS_PER_DAY), startTime };
};

/*
 * A timed range that does not end after it starts has no representation on a destination
 * that insists on a positive span — Google answers "The specified time range is empty."
 * (400), and RFC 5545 §3.6.1 requires DTEND to be later in time than DTSTART, so a CalDAV
 * resource carrying both properties cannot hold it either. The start is the instant the
 * source states outright, so the range becomes the shortest span a minute-resolution grid
 * renders and the event lands as a point in time rather than going missing.
 */
const POINT_IN_TIME_DURATION_MS = MS_PER_MINUTE;

const resolvePointInTimeRange = ({ endTime, startTime }: EventTimeRange): EventTimeRange => {
  if (endTime.getTime() > startTime.getTime()) {
    return { endTime, startTime };
  }

  return { endTime: new Date(startTime.getTime() + POINT_IN_TIME_DURATION_MS), startTime };
};

/*
 * The last instant a range reaches. A range that does not end after it starts covers no
 * interval, so its end says nothing about where it sits — it reaches only the one instant
 * it names: the start the source states outright. Judging a window bound against this
 * instant keeps an inverted range from being discarded for an end that predates a window
 * its start sits inside.
 */
const resolveTimeRangeEnd = ({ endTime, startTime }: EventTimeRange): Date => {
  if (endTime.getTime() > startTime.getTime()) {
    return endTime;
  }

  return startTime;
};

const isEmptyTimeRange =({ endTime, startTime }: EventTimeRange): boolean =>
  endTime.getTime() === startTime.getTime();

const isInvertedTimeRange = ({ endTime, startTime }: EventTimeRange): boolean =>
  endTime.getTime() < startTime.getTime();

/*
 * A range that does not end after it starts covers no interval, so a half-open overlap
 * test would place it outside every window — including the one it starts on. Window
 * membership must not depend on whether a particular layer happens to widen the range
 * first, so a degenerate range is judged by the one instant it names: the start the
 * source states outright. Every layer that applies a sync window uses this predicate, so
 * an event that survives ingest also survives materialization and reconciliation.
 */
const overlapsTimeWindow = (
  { endTime, startTime }: EventTimeRange,
  windowStart: Date,
  windowEnd: Date,
): boolean => {
  if (endTime.getTime() <= startTime.getTime()) {
    return startTime >= windowStart && startTime < windowEnd;
  }
  return endTime > windowStart && startTime < windowEnd;
};

export {
  isEmptyTimeRange,
  isInvertedTimeRange,
  overlapsTimeWindow,
  POINT_IN_TIME_DURATION_MS,
  resolvePointInTimeRange,
  resolveTimeRangeEnd,
  resolveWholeDayTimeRange,
};
export type { EventTimeRange };
