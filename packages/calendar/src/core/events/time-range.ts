import { MS_PER_DAY } from "@keeper.sh/constants";
import { resolveIsAllDayEvent } from "./all-day";
import type { AllDayEventShape } from "./all-day";

interface EventTimeRange {
  startTime: Date;
  endTime: Date;
}

/*
 * Destinations reject a range that ends at or before it starts: Google answers
 * "The specified time range is empty." with a 400, and the mapping is never written,
 * so the event is re-pushed on every run forever. An all-day range carries an
 * exclusive end date, so a same-date pair means the single day it starts on.
 */
const resolveMirrorableTimeRange = (event: AllDayEventShape): EventTimeRange | null => {
  const { endTime, startTime } = event;
  const durationMs = endTime.getTime() - startTime.getTime();

  if (resolveIsAllDayEvent(event)) {
    if (durationMs >= MS_PER_DAY) {
      return { endTime, startTime };
    }
    return { endTime: new Date(startTime.getTime() + MS_PER_DAY), startTime };
  }

  if (durationMs <= 0) {
    return null;
  }

  return { endTime, startTime };
};

export { resolveMirrorableTimeRange };
export type { EventTimeRange };
