import { MS_PER_DAY, MS_PER_MINUTE } from "@keeper.sh/constants";
import type { AllDayEventShape } from "./all-day";
import { resolveIsAllDayEvent } from "./all-day";

interface EventTimeRange {
  startTime: Date;
  endTime: Date;
}

/*
 * An all-day range is a pair of RFC 5545 §3.6.1 DATEs: an inclusive first day and an
 * exclusive end day. Every destination serializes one that way and every read-back parses
 * those DATEs as UTC midnights, so a range that does not sit on UTC day boundaries comes
 * back narrower than it was written and the mirror is judged changed on every run. The
 * range is therefore snapped onto the days it actually touches — the start floored to its
 * UTC midnight, the end raised to the next UTC midnight at or after it — and a range that
 * covers no whole day still names the single day it starts on.
 */
const floorToUtcDay = (time: Date): Date =>
  new Date(Math.floor(time.getTime() / MS_PER_DAY) * MS_PER_DAY);

const ceilToUtcDay = (time: Date): Date =>
  new Date(Math.ceil(time.getTime() / MS_PER_DAY) * MS_PER_DAY);

const resolveWholeDayTimeRange = ({ endTime, startTime }: EventTimeRange): EventTimeRange => {
  const dayStart = floorToUtcDay(startTime);
  const dayEnd = ceilToUtcDay(endTime);
  if (dayEnd.getTime() > dayStart.getTime()) {
    return { endTime: dayEnd, startTime: dayStart };
  }

  return { endTime: new Date(dayStart.getTime() + MS_PER_DAY), startTime: dayStart };
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

const isEmptyTimeRange = ({ endTime, startTime }: EventTimeRange): boolean =>
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

/*
 * The one shaping every outbound surface owes a range before it publishes it: an all-day
 * range onto the UTC days it touches, a timed range onto a positive span. Destinations
 * whose API accepts a shape this would rewrite state that exception at their own seam.
 */
const resolveRepresentableTimeRange = (range: AllDayEventShape): EventTimeRange => {
  if (resolveIsAllDayEvent(range)) {
    return resolveWholeDayTimeRange(range);
  }

  return resolvePointInTimeRange(range);
};

/*
 * A surface that publishes a shaped range owes the same range to the question "is this
 * event in that window?". Deciding membership on the stored range instead makes one row
 * two different events depending on how wide the caller's window is — a whole-day read
 * reports an off-grid all-day event across the day it snaps to, while a read of one hour
 * inside that day reports nothing. The published span is the answer to both.
 */
const overlapsRepresentableTimeWindow = (
  range: AllDayEventShape,
  windowStart: Date,
  windowEnd: Date,
): boolean => overlapsTimeWindow(resolveRepresentableTimeRange(range), windowStart, windowEnd);

/*
 * The furthest shaping can carry either bound away from the stored one: a whole-day snap
 * pulls a start back to its UTC midnight and pushes an end on to the next, and a point in
 * time extends an end by a minute. A scan that wants every row whose published span could
 * reach a window widens the window by this much and leaves the rest to the predicate.
 */
const REPRESENTABLE_RANGE_SLACK_MS = MS_PER_DAY;

export {
  isEmptyTimeRange,
  isInvertedTimeRange,
  overlapsRepresentableTimeWindow,
  overlapsTimeWindow,
  POINT_IN_TIME_DURATION_MS,
  REPRESENTABLE_RANGE_SLACK_MS,
  resolvePointInTimeRange,
  resolveRepresentableTimeRange,
  resolveTimeRangeEnd,
  resolveWholeDayTimeRange,
};
export type { EventTimeRange };
