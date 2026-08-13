import type { MaterializedSyncableEvent } from "../../../core/types";
import { resolveIsAllDayEvent } from "../../../core/events/all-day";
import {
  isInvertedTimeRange,
  resolvePointInTimeRange,
  resolveWholeDayTimeRange,
} from "../../../core/events/time-range";

// Graph needs all-day events on whole days and refuses inverted ranges, but accepts zero-duration ones as-is.
const normalizeOutlookEvent = (event: MaterializedSyncableEvent): MaterializedSyncableEvent => {
  if (resolveIsAllDayEvent(event)) {
    return { ...event, ...resolveWholeDayTimeRange(event) };
  }

  if (isInvertedTimeRange(event)) {
    return { ...event, ...resolvePointInTimeRange(event) };
  }

  return event;
};

export { normalizeOutlookEvent };
