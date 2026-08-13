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

const isEmptyTimeRange =({ endTime, startTime }: EventTimeRange): boolean =>
  endTime.getTime() === startTime.getTime();

const isInvertedTimeRange = ({ endTime, startTime }: EventTimeRange): boolean =>
  endTime.getTime() < startTime.getTime();

export {
  isEmptyTimeRange,
  isInvertedTimeRange,
  POINT_IN_TIME_DURATION_MS,
  resolvePointInTimeRange,
  resolveWholeDayTimeRange,
};
export type { EventTimeRange };
