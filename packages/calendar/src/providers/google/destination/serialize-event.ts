import type { GoogleEvent } from "@keeper.sh/data-schemas";
import type { SyncableEvent } from "../../../core/types";
import { resolveIsAllDayEvent } from "../../../core/events/all-day";

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

const canSerializeGoogleEvent = (event: SyncableEvent): boolean => {
  if (event.availability === "workingElsewhere") {
    return false;
  }

  return true;
};

const serializeGoogleEvent = (
  event: SyncableEvent,
  uid: string,
  recurrenceRule?: string | null,
): GoogleEvent | null => {
  if (!canSerializeGoogleEvent(event)) {
    return null;
  }

  const isAllDay = resolveIsAllDayEvent(event);

  return {
    description: event.description,
    end: buildDateField(event.endTime, isAllDay, event.startTimeZone, recurrenceRule),
    iCalUID: uid,
    location: event.location,
    start: buildDateField(event.startTime, isAllDay, event.startTimeZone, recurrenceRule),
    summary: event.summary,
    ...(event.availability === "free" && { transparency: "transparent" }),
    ...(recurrenceRule && { recurrence: [`RRULE:${recurrenceRule}`] }),
  };
};

export { canSerializeGoogleEvent, serializeGoogleEvent };
