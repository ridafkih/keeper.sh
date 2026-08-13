import type { MaterializedSyncableEvent } from "../../../core/types";
import { resolveIsAllDayEvent } from "../../../core/events/all-day";
import {
  resolvePointInTimeRange,
  resolveWholeDayTimeRange,
} from "../../../core/events/time-range";

/*
 * The serializer always writes both DTSTART and DTEND, and RFC 5545 §3.6.1 requires
 * DTEND to be later in time than DTSTART, so a range that does not end after it starts
 * has no conformant CalDAV resource — DATE-valued or not. Widening happens here rather
 * than in the serializer so the mapping, the content hash and the pushed resource all
 * agree on one range instead of the read-back disagreeing with the write on every run.
 */
const normalizeCalDAVEvent = (event: MaterializedSyncableEvent): MaterializedSyncableEvent => {
  if (resolveIsAllDayEvent(event)) {
    return { ...event, ...resolveWholeDayTimeRange(event) };
  }

  return { ...event, ...resolvePointInTimeRange(event) };
};

export { normalizeCalDAVEvent };
