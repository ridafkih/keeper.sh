import { MS_PER_DAY, MS_PER_MINUTE } from "@keeper.sh/constants";
import type { AllDayEventShape } from "./all-day";
import { resolveIsAllDayEvent } from "./all-day";

interface EventTimeRange {
  startTime: Date;
  endTime: Date;
}

// RFC 5545 §3.6.1 all-day DATEs read back as UTC midnights, so the range must sit on the UTC day grid.
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

// RFC 5545 §3.6.1 requires DTEND later than DTSTART, and Google 400s a non-positive span.
const POINT_IN_TIME_DURATION_MS = MS_PER_MINUTE;

const resolvePointInTimeRange = ({ endTime, startTime }: EventTimeRange): EventTimeRange => {
  if (endTime.getTime() > startTime.getTime()) {
    return { endTime, startTime };
  }

  return { endTime: new Date(startTime.getTime() + POINT_IN_TIME_DURATION_MS), startTime };
};

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

// Every layer applying a sync window must use this predicate, or an event survives one stage and not the next.
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

const resolveRepresentableTimeRange = (range: AllDayEventShape): EventTimeRange => {
  if (resolveIsAllDayEvent(range)) {
    return resolveWholeDayTimeRange(range);
  }

  return resolvePointInTimeRange(range);
};

// Window membership must be judged on the published span, not the stored one, or reads disagree with writes.
const overlapsRepresentableTimeWindow = (
  range: AllDayEventShape,
  windowStart: Date,
  windowEnd: Date,
): boolean => overlapsTimeWindow(resolveRepresentableTimeRange(range), windowStart, windowEnd);

// Widest shift shaping can apply to either bound; scans widen by this and let the predicate decide.
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
