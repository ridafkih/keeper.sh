import type {
  IcsCalendar,
  IcsDateObject,
  IcsDuration,
  IcsEvent,
  IcsExceptionDates,
} from "ts-ics";
import type { EventTimeSlot } from "./types";
import {
  KEEPER_EVENT_SUFFIX,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  MS_PER_SECOND,
  MS_PER_WEEK,
} from "@keeper.sh/constants";
import { normalizeTimezone } from "./normalize-timezone";

const DEFAULT_DURATION_VALUE = 0;

const durationToMs = (duration: IcsDuration): number => {
  const {
    weeks = DEFAULT_DURATION_VALUE,
    days = DEFAULT_DURATION_VALUE,
    hours = DEFAULT_DURATION_VALUE,
    minutes = DEFAULT_DURATION_VALUE,
    seconds = DEFAULT_DURATION_VALUE,
  } = duration;
  return (
    weeks * MS_PER_WEEK +
    days * MS_PER_DAY +
    hours * MS_PER_HOUR +
    minutes * MS_PER_MINUTE +
    seconds * MS_PER_SECOND
  );
};

const getEventEndTime = (event: IcsEvent, startTime: Date): Date => {
  if ("end" in event && event.end) {
    return event.end.date;
  }

  if ("duration" in event && event.duration) {
    return new Date(startTime.getTime() + durationToMs(event.duration));
  }

  return startTime;
};

const isKeeperEvent = (uid: string | undefined): boolean =>
  uid?.endsWith(KEEPER_EVENT_SUFFIX) ?? false;

const getEventStartTimeZone = (event: IcsEvent): string | undefined =>
  normalizeTimezone(event.start.local?.timezone);

const getEventAvailability = (event: IcsEvent) => {
  if (event.timeTransparent === "TRANSPARENT") {
    return "free";
  }

  if (event.timeTransparent === "OPAQUE") {
    return "busy";
  }

  return null;
};

const buildRecurrenceIdentity = (uid: string, recurrenceDate: Date): string =>
  `${uid}|${recurrenceDate.toISOString()}`;

const mergeExceptionDates = (
  exceptionDates: IcsExceptionDates | undefined,
  cancelledDates: IcsDateObject[],
): IcsExceptionDates | undefined => {
  const merged = new Map<string, IcsDateObject>();
  for (const exceptionDate of [...exceptionDates ?? [], ...cancelledDates]) {
    merged.set(exceptionDate.date.toISOString(), exceptionDate);
  }
  if (merged.size === 0) {
    return;
  }
  return [...merged.values()];
};

const parseIcsEvents = (calendar: IcsCalendar): EventTimeSlot[] => {
  const result: EventTimeSlot[] = [];
  const cancelledMasterUids = new Set<string>();
  const cancelledRecurrences = new Map<string, IcsDateObject[]>();

  for (const event of calendar.events ?? []) {
    if (event.status !== "CANCELLED" || !event.uid) {
      continue;
    }
    if (!event.recurrenceId) {
      cancelledMasterUids.add(event.uid);
      continue;
    }
    const dates = cancelledRecurrences.get(event.uid) ?? [];
    dates.push(event.recurrenceId.value);
    cancelledRecurrences.set(event.uid, dates);
  }

  const cancelledRecurrenceIdentities = new Set(
    [...cancelledRecurrences].flatMap(([uid, dates]) =>
      dates.map((date) => buildRecurrenceIdentity(uid, date.date))),
  );

  for (const event of calendar.events ?? []) {
    if (isKeeperEvent(event.uid)) {
      continue;
    }
    if (!event.uid) {
      continue;
    }
    if (event.status === "CANCELLED" || cancelledMasterUids.has(event.uid)) {
      continue;
    }
    if (
      event.recurrenceId
      && cancelledRecurrenceIdentities.has(
        buildRecurrenceIdentity(event.uid, event.recurrenceId.value.date),
      )
    ) {
      continue;
    }

    const startTime = event.start.date;
    const availability = getEventAvailability(event);
    let { exceptionDates } = event;
    if (event.recurrenceRule) {
      exceptionDates = mergeExceptionDates(
        event.exceptionDates,
        cancelledRecurrences.get(event.uid) ?? [],
      );
    }

    result.push({
      ...availability && { availability },
      description: event.description,
      endTime: getEventEndTime(event, startTime),
      exceptionDates,
      recurrenceId: event.recurrenceId?.value?.date,
      isAllDay: event.start.type === "DATE",
      location: event.location,
      recurrenceRule: event.recurrenceRule,
      startTime,
      startTimeZone: getEventStartTimeZone(event),
      title: event.summary,
      uid: event.uid,
    });
  }

  return result;
};

export { parseIcsEvents };
