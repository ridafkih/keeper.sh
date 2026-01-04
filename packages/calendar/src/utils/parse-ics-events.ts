import type { IcsCalendar, IcsEvent, IcsDuration } from "ts-ics";
import type { EventTimeSlot } from "../types";
import {
  MS_PER_SECOND,
  MS_PER_MINUTE,
  MS_PER_HOUR,
  MS_PER_DAY,
  MS_PER_WEEK,
  KEEPER_EVENT_SUFFIX,
} from "@keeper.sh/constants";

const durationToMs = (duration: IcsDuration): number => {
  const { weeks = 0, days = 0, hours = 0, minutes = 0, seconds = 0 } = duration;
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

export const parseIcsEvents = (calendar: IcsCalendar): EventTimeSlot[] => {
  const result: EventTimeSlot[] = [];

  for (const event of calendar.events ?? []) {
    if (isKeeperEvent(event.uid)) continue;
    if (!event.uid) continue;

    const startTime = event.start.date;
    result.push({
      uid: event.uid,
      startTime,
      endTime: getEventEndTime(event, startTime),
    });
  }

  return result;
};
