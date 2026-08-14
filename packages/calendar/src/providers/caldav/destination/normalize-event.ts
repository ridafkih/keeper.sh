import type { MaterializedSyncableEvent } from "../../../core/types";
import { resolveRepresentableTimeRange } from "../../../core/events/time-range";
import { toPlainTextDescription } from "../../../core/events/plain-text-description";

/*
 * The serializer always writes DTSTART and DTEND, and RFC 5545 §3.6.1 requires
 * DTEND later than DTSTART. §3.8.1.5 makes DESCRIPTION a TEXT property, so
 * markup left in it is what iCloud, Fastmail and Thunderbird show the reader.
 * This is the only place the projection runs: the serializer writes what it is
 * handed, so the bytes on the server are the bytes the comparison holds.
 */
const normalizeCalDAVEvent = (event: MaterializedSyncableEvent): MaterializedSyncableEvent =>
  ({
    ...event,
    ...resolveRepresentableTimeRange(event),
    description: toPlainTextDescription(event.description),
  });

export { normalizeCalDAVEvent };
