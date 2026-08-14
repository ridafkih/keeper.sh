import type { MaterializedSyncableEvent } from "../../../core/types";
import {
  POINT_IN_TIME_DURATION_MS,
  resolveRepresentableTimeRange,
} from "../../../core/events/time-range";
import { toPlainTextDescription } from "../../../core/events/plain-text-description";

/*
 * Google 400s any non-positive span with "The specified time range is empty.",
 * and it sanitizes a description by keeping an HTML wrapper while discarding
 * what the wrapper held, so the mirror loses the text.
 */
const normalizeGoogleEvent = (event: MaterializedSyncableEvent): MaterializedSyncableEvent =>
  ({
    ...event,
    ...resolveRepresentableTimeRange(event),
    description: toPlainTextDescription(event.description),
  });

export { normalizeGoogleEvent, POINT_IN_TIME_DURATION_MS };
