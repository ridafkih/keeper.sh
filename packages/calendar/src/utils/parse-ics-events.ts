import type { IcsCalendar, IcsEvent, IcsDuration } from "ts-ics";
import type { EventTimeSlot } from "../types";

const FILTER_SUFFIX = "@keeper.sh";

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = MS_PER_SECOND * 60;
const MS_PER_HOUR = MS_PER_MINUTE * 60;
const MS_PER_DAY = MS_PER_HOUR * 24;
const MS_PER_WEEK = MS_PER_DAY * 7;

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
  uid?.endsWith(FILTER_SUFFIX) ?? false;

export const parseIcsEvents = (calendar: IcsCalendar): EventTimeSlot[] => {
  const result: EventTimeSlot[] = [];

  for (const event of calendar.events ?? []) {
    if (isKeeperEvent(event.uid)) continue;

    const startTime = event.start.date;
    result.push({
      startTime,
      endTime: getEventEndTime(event, startTime),
    });
  }

  return result;
};
