import { MS_PER_DAY } from "@keeper.sh/constants";

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

const isEmptyTimeRange = ({ endTime, startTime }: EventTimeRange): boolean =>
  endTime.getTime() === startTime.getTime();

const isInvertedTimeRange = ({ endTime, startTime }: EventTimeRange): boolean =>
  endTime.getTime() < startTime.getTime();

export { isEmptyTimeRange, isInvertedTimeRange, resolveWholeDayTimeRange };
export type { EventTimeRange };
