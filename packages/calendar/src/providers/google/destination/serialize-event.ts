import type { GoogleEvent } from "@keeper.sh/data-schemas";
import type { SyncableEvent } from "../../../core/types";
import { resolveIsAllDayEvent } from "../../../core/events/all-day";

const formatDateOnly = (value: Date): string => value.toISOString().slice(0, 10);

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

  const googleEvent: GoogleEvent = {
    description: event.description,
    iCalUID: uid,
    summary: event.summary,
  };

  googleEvent.location = event.location;
  if (event.availability === "free") {
    googleEvent.transparency = "transparent";
  }

  if (isAllDay) {
    googleEvent.start = { date: formatDateOnly(event.startTime) };
    googleEvent.end = { date: formatDateOnly(event.endTime) };
  } else {
    const recurrenceTimeZone = event.startTimeZone ?? "UTC";
    googleEvent.start = {
      dateTime: event.startTime.toISOString(),
      ...(recurrenceRule && { timeZone: recurrenceTimeZone }),
    };
    googleEvent.end = {
      dateTime: event.endTime.toISOString(),
      ...(recurrenceRule && { timeZone: recurrenceTimeZone }),
    };
  }

  if (recurrenceRule) {
    googleEvent.recurrence = [`RRULE:${recurrenceRule}`];
  }

  return googleEvent;
};

export { canSerializeGoogleEvent, serializeGoogleEvent };
