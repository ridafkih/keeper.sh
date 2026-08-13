import type { MaterializedSyncableEvent } from "../../../core/types";
import { resolveIsAllDayEvent } from "../../../core/events/all-day";
import { resolveWholeDayTimeRange } from "../../../core/events/time-range";

/*
 * Graph requires an all-day event to run midnight to midnight across whole days, so a
 * same-date all-day range has to be widened to the day it names. Timed events are left
 * alone: Graph is not documented to reject a zero-duration event and none has been seen
 * failing in production, so there is nothing here to justify rewriting one.
 */
const normalizeOutlookEvent = (event: MaterializedSyncableEvent): MaterializedSyncableEvent => {
  if (!resolveIsAllDayEvent(event)) {
    return event;
  }

  return { ...event, ...resolveWholeDayTimeRange(event) };
};

export { normalizeOutlookEvent };
