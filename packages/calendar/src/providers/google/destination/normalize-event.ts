import type { MaterializedSyncableEvent } from "../../../core/types";
import {
  POINT_IN_TIME_DURATION_MS,
  resolveRepresentableTimeRange,
} from "../../../core/events/time-range";
import { stripConferenceDelimiters } from "./conference-block";

/*
 * Google 400s any non-positive span with "The specified time range is empty.".
 * A description's markup it stores as it was sent; its own conference block it
 * does not, stripping the region from a mirror that carries no conference and
 * leaving a divergence that replaces the event on every run.
 */
const normalizeGoogleEvent = (event: MaterializedSyncableEvent): MaterializedSyncableEvent =>
  ({
    ...event,
    ...resolveRepresentableTimeRange(event),
    description: stripConferenceDelimiters(event.description),
  });

export { normalizeGoogleEvent, POINT_IN_TIME_DURATION_MS };
