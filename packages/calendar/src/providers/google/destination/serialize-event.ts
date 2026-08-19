import type { GoogleEvent } from "@keeper.sh/data-schemas";
import type { MaterializedSyncableEvent } from "../../../core/types";
import { resolveIsAllDayEvent } from "../../../core/events/all-day";
import { KEEPER_EVENT_UID_PROPERTY, toGoogleEventId } from "./ooo-identity";

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
  // Google out-of-office events must be timed; fall back to a normal busy event for all-day.
  const asOutOfOffice = event.availability === "oof" && !isAllDay;

  return {
    description: event.description,
    end: buildDateField(event.endTime, isAllDay, event.startTimeZone, recurrenceRule),
    location: event.location,
    start: buildDateField(event.startTime, isAllDay, event.startTimeZone, recurrenceRule),
    summary: event.summary,
    // OOO cannot use events.import; iCalUID on insert leaves tombstones that 409 forever.
    // Use a deterministic Google event id + private property instead.
    ...(asOutOfOffice
      ? {
        eventType: "outOfOffice",
        extendedProperties: {
          private: { [KEEPER_EVENT_UID_PROPERTY]: uid },
        },
        id: toGoogleEventId(uid),
        outOfOfficeProperties: {
          autoDeclineMode: "declineAllConflictingInvitations",
        },
        transparency: "opaque",
      }
      : {
        iCalUID: uid,
        ...(event.availability === "free" && { transparency: "transparent" }),
      }),
    ...(recurrenceRule && { recurrence: [`RRULE:${recurrenceRule}`] }),
  };
};

export { canSerializeGoogleEvent, serializeGoogleEvent };
