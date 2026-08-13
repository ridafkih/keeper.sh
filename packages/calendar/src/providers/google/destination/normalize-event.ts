import type { MaterializedSyncableEvent } from "../../../core/types";
import { resolveIsAllDayEvent } from "../../../core/events/all-day";
import {
  POINT_IN_TIME_DURATION_MS,
  resolvePointInTimeRange,
  resolveWholeDayTimeRange,
} from "../../../core/events/time-range";

/*
 * Google rejects any event that does not end after it starts with
 * "The specified time range is empty." (400), so a zero-duration event — legal per
 * RFC 5545 §3.6.1, which ends a timed VEVENT with no DTEND at its DTSTART — has no
 * native Google representation. A range that ends before it starts is inconsistent
 * instead of legal, but its start is still the instant the source states outright.
 * Both become a point in time so the event reaches the destination.
 */
const normalizeGoogleEvent = (event: MaterializedSyncableEvent): MaterializedSyncableEvent => {
  if (resolveIsAllDayEvent(event)) {
    return { ...event, ...resolveWholeDayTimeRange(event) };
  }

  return { ...event, ...resolvePointInTimeRange(event) };
};

export { normalizeGoogleEvent, POINT_IN_TIME_DURATION_MS };
