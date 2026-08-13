import { MS_PER_MINUTE } from "@keeper.sh/constants";
import type { MaterializedSyncableEvent } from "../../../core/types";
import { resolveIsAllDayEvent } from "../../../core/events/all-day";
import { resolveWholeDayTimeRange } from "../../../core/events/time-range";

/*
 * Google rejects any event that does not end after it starts with
 * "The specified time range is empty." (400), so a zero-duration event — legal per
 * RFC 5545 §3.6.1, which ends a timed VEVENT with no DTEND at its DTSTART — has no
 * native Google representation. A range that ends before it starts is inconsistent
 * instead of legal, but its start is still the instant the source states outright.
 * Both become the shortest span Google's minute-resolution grid renders, so the event
 * reaches the destination as a point in time rather than going missing.
 */
const POINT_IN_TIME_DURATION_MS = MS_PER_MINUTE;

const normalizeGoogleEvent = (event: MaterializedSyncableEvent): MaterializedSyncableEvent => {
  if (resolveIsAllDayEvent(event)) {
    return { ...event, ...resolveWholeDayTimeRange(event) };
  }

  if (event.endTime > event.startTime) {
    return event;
  }

  return {
    ...event,
    endTime: new Date(event.startTime.getTime() + POINT_IN_TIME_DURATION_MS),
  };
};

export { normalizeGoogleEvent, POINT_IN_TIME_DURATION_MS };
