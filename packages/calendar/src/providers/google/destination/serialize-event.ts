import type { GoogleEvent } from "@keeper.sh/data-schemas";
import type { MaterializedSyncableEvent } from "../../../core/types";
import { resolveIsAllDayEvent } from "../../../core/events/all-day";
import { resolveMirrorableTimeRange } from "../../../core/events/time-range";

const formatDateOnly = (value: Date): string => value.toISOString().slice(0, 10);

const buildDateField = (
  time: Date,
  isAllDay: boolean,
  startTimeZone: string | undefined,
  recurrenceRule: string | null | undefined,
): NonNullable<GoogleEvent["start"]> => {
  if (isAllDay) {
    return { date: formatDateOnly(time) };
  }

  const timeZone = startTimeZone ?? "UTC";
  return {
    dateTime: time.toISOString(),
    ...(recurrenceRule && { timeZone }),
  };
};

const canSerializeGoogleEvent = (event: MaterializedSyncableEvent): boolean => {
  if (event.availability === "workingElsewhere") {
    return false;
  }

  return true;
};

const serializeGoogleEvent = (
  event: MaterializedSyncableEvent,
  uid: string,
  recurrenceRule?: string | null,
): GoogleEvent | null => {
  if (!canSerializeGoogleEvent(event)) {
    return null;
  }

  const isAllDay = resolveIsAllDayEvent(event);
  const range = resolveMirrorableTimeRange(event);

  if (!range) {
    return null;
  }

  return {
    description: event.description,
    end: buildDateField(range.endTime, isAllDay, event.startTimeZone, recurrenceRule),
    iCalUID: uid,
    location: event.location,
    start: buildDateField(range.startTime, isAllDay, event.startTimeZone, recurrenceRule),
    summary: event.summary,
    ...(event.availability === "free" && { transparency: "transparent" }),
    ...(recurrenceRule && { recurrence: [`RRULE:${recurrenceRule}`] }),
  };
};

export { canSerializeGoogleEvent, serializeGoogleEvent };
