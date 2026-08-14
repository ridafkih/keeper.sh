import type { MaterializedSyncableEvent } from "../../../core/types";
import {
  POINT_IN_TIME_DURATION_MS,
  resolveRepresentableTimeRange,
} from "../../../core/events/time-range";
import { toPlainTextDescription } from "../../../core/events/plain-text-description";

/*
 * Google 400s any non-positive span with "The specified time range is empty.",
 * and it rewrites an HTML description into the text it renders to, so what it
 * stores is never what was sent and the mirror is replaced on every run.
 */
const normalizeGoogleEvent = (event: MaterializedSyncableEvent): MaterializedSyncableEvent =>
  ({
    ...event,
    ...resolveRepresentableTimeRange(event),
    description: toPlainTextDescription(event.description),
  });

export { normalizeGoogleEvent, POINT_IN_TIME_DURATION_MS };
