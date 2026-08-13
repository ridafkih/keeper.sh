import type { MaterializedSyncableEvent } from "../../../core/types";
import {
  POINT_IN_TIME_DURATION_MS,
  resolveRepresentableTimeRange,
} from "../../../core/events/time-range";

// Google 400s any non-positive span with "The specified time range is empty."
const normalizeGoogleEvent = (event: MaterializedSyncableEvent): MaterializedSyncableEvent =>
  ({ ...event, ...resolveRepresentableTimeRange(event) });

export { normalizeGoogleEvent, POINT_IN_TIME_DURATION_MS };
