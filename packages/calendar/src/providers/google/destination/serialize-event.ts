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

/** Google OOO cannot be all-day; reuse the stored instants as timed dateTimes. */
const buildTimedOooDateField = (time: Date): NonNullable<GoogleEvent["start"]> => ({
  dateTime: time.toISOString(),
});

/**
 * All-day ends are exclusive (Sep 1 00:00 = through Aug 31). Timed Google OOO with
 * that exclusive midnight displays as ending on Sep 1 — use the last second instead.
 */
const toTimedOooEndTime = (endTime: Date, isAllDay: boolean): Date => {
  if (!isAllDay) {
    return endTime;
  }
  return new Date(endTime.getTime() - 1000);
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
  const asOutOfOffice = event.availability === "oof";

  if (asOutOfOffice) {
    return {
      description: event.description,
      end: buildTimedOooDateField(toTimedOooEndTime(event.endTime, isAllDay)),
      eventType: "outOfOffice",
      extendedProperties: {
        private: { [KEEPER_EVENT_UID_PROPERTY]: uid },
      },
      id: toGoogleEventId(uid),
      location: event.location,
      outOfOfficeProperties: {
        autoDeclineMode: "declineAllConflictingInvitations",
      },
      start: buildTimedOooDateField(event.startTime),
      summary: event.summary,
      transparency: "opaque",
      ...(recurrenceRule && { recurrence: [`RRULE:${recurrenceRule}`] }),
    };
  }

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

export { canSerializeGoogleEvent, serializeGoogleEvent, toTimedOooEndTime };
