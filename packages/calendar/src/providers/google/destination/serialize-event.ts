import type { GoogleEvent } from "@keeper.sh/data-schemas";
import type { MaterializedSyncableEvent } from "../../../core/types";
import { resolveIsAllDayEvent } from "../../../core/events/all-day";
import { normalizeGoogleEvent } from "./normalize-event";

const formatDateOnly = (value: Date): string => value.toISOString().slice(0, 10);

const buildDateField = (time: Date, isAllDay: boolean): NonNullable<GoogleEvent["start"]> => {
  if (isAllDay) {
    return { date: formatDateOnly(time) };
  }

  return { dateTime: time.toISOString() };
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
): GoogleEvent | null => {
  if (!canSerializeGoogleEvent(event)) {
    return null;
  }

  const isAllDay = resolveIsAllDayEvent(event);
  const normalized = normalizeGoogleEvent(event);

  return {
    description: normalized.description,
    end: buildDateField(normalized.endTime, isAllDay),
    iCalUID: uid,
    location: event.location,
    start: buildDateField(normalized.startTime, isAllDay),
    summary: event.summary,
    ...(event.availability === "free" && { transparency: "transparent" }),
    ...(event.isPrivate && { visibility: "private" }),
  };
};

export { canSerializeGoogleEvent, serializeGoogleEvent };
