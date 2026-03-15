import type { GoogleEvent } from "@keeper.sh/data-schemas";
import type { SyncableEvent } from "../../core";
import { resolveIsAllDayEvent } from "../../core";

const formatDateOnly = (value: Date): string => value.toISOString().slice(0, 10);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const isSingleDayAllDayEvent = (event: SyncableEvent): boolean => event.endTime.getTime() - event.startTime.getTime() === MS_PER_DAY;

const buildWorkingLocationProperties = (
  event: Pick<SyncableEvent, "location" | "summary">,
): NonNullable<GoogleEvent["workingLocationProperties"]> => {
  const label = event.location?.trim() || event.summary.trim();

  return {
    customLocation: { label },
    type: "customLocation",
  };
};

const canSerializeGoogleEvent = (event: SyncableEvent): boolean => {
  if (event.availability !== "workingElsewhere") {
    return true;
  }

  if (!resolveIsAllDayEvent(event)) {
    return true;
  }

  return isSingleDayAllDayEvent(event);
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

  if (event.availability === "workingElsewhere") {
    googleEvent.eventType = "workingLocation";
    googleEvent.transparency = "transparent";
    googleEvent.visibility = "public";
    googleEvent.workingLocationProperties = buildWorkingLocationProperties(event);
  } else {
    googleEvent.location = event.location;
    if (event.availability === "free") {
      googleEvent.transparency = "transparent";
    }
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
