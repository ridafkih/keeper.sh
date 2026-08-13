import type { MaterializedSyncableEvent } from "../../../core/types";
import { resolveIsAllDayEvent } from "../../../core/events/all-day";
import {
  isInvertedTimeRange,
  resolvePointInTimeRange,
  resolveWholeDayTimeRange,
} from "../../../core/events/time-range";

/*
 * Graph requires an all-day event to run midnight to midnight across whole days, so a
 * same-date all-day range has to be widened to the day it names. A timed range that ends
 * before it starts is refused outright — "The end date must be after the start date." —
 * so it becomes a point in time, keeping the start the source states. A zero-duration
 * timed range is left alone: Graph accepts it and renders it on the grid, so rewriting
 * one would move an event Graph already represents faithfully.
 */
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
