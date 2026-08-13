import type { MaterializedSyncableEvent } from "../../../core/types";
import { resolveRepresentableTimeRange } from "../../../core/events/time-range";

// The serializer always writes DTSTART and DTEND, and RFC 5545 §3.6.1 requires DTEND later than DTSTART.
const normalizeCalDAVEvent = (event: MaterializedSyncableEvent): MaterializedSyncableEvent =>
  ({ ...event, ...resolveRepresentableTimeRange(event) });

export { normalizeCalDAVEvent };
