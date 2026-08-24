import { instantToWallTime, resolveTimeZone, wallTimeToInstant } from "@keeper.sh/calendar";
import { MS_PER_DAY } from "@keeper.sh/constants";

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const DAYS_PER_WEEK = 7;
const MAX_FREE_SLOTS = 200;
const DEFAULT_FREE_SLOTS = 50;
const WALL_CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

class FreeTimeValidationError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "FreeTimeValidationError";
  }
}

interface TimeInterval {
  start: Date;
  end: Date;
}

interface FreeSlot {
  start: string;
  end: string;
  durationMinutes: number;
}

interface WorkingHours {
  startMinute: number;
  endMinute: number;
  days: number[] | null;
}

interface FreeTimeOptions {
  durationMinutes: number;
  timezone: string;
  workingHours: WorkingHours | null;
  limit: number;
}

interface MsInterval {
  start: number;
  end: number;
}

const parseWallClockMinute = (value: string, label: string): number => {
  const match = WALL_CLOCK_PATTERN.exec(value);
  if (!match) {
    throw new FreeTimeValidationError(`${label} must be a 24-hour wall-clock time such as 09:00`);
  }
  return Number(match[1]) * MINUTES_PER_HOUR + Number(match[2]);
};

const parseWorkingDays = (value: string): number[] => {
  const days = value
    .split(",")
    .filter(Boolean)
    .map((day) => Number(day.trim()));

  if (days.length === 0) {
    throw new FreeTimeValidationError("workingDays must list at least one day");
  }
  if (days.some((day) => !Number.isInteger(day) || day < 0 || day >= DAYS_PER_WEEK)) {
    throw new FreeTimeValidationError("workingDays must be integers from 0 (Sunday) to 6 (Saturday)");
  }

  return days;
};

const parseWorkingHours = (
  start: string | null,
  end: string | null,
  days: string | null,
): WorkingHours | null => {
  if (!start && !end) {
    if (days) {
      throw new FreeTimeValidationError(
        "workingDays requires workingHoursStart and workingHoursEnd",
      );
    }
    return null;
  }
  if (!start || !end) {
    throw new FreeTimeValidationError(
      "workingHoursStart and workingHoursEnd must be provided together",
    );
  }

  const startMinute = parseWallClockMinute(start, "workingHoursStart");
  const endMinute = parseWallClockMinute(end, "workingHoursEnd");

  if (startMinute >= endMinute) {
    throw new FreeTimeValidationError("workingHoursStart must be before workingHoursEnd");
  }

  if (!days) {
    return { days: null, endMinute, startMinute };
  }

  return { days: parseWorkingDays(days), endMinute, startMinute };
};

const toMsInterval = ({ start, end }: TimeInterval): MsInterval => ({
  end: end.getTime(),
  start: start.getTime(),
});

const mergeIntervals = (intervals: MsInterval[]): MsInterval[] => {
  const ordered = intervals
    .filter(({ start, end }) => end > start)
    .toSorted((left, right) => left.start - right.start);
  const merged: MsInterval[] = [];

  for (const interval of ordered) {
    const previous = merged.at(-1);
    if (!previous || interval.start > previous.end) {
      merged.push(interval);
      continue;
    }
    if (interval.end > previous.end) {
      merged.splice(-1, 1, { end: interval.end, start: previous.start });
    }
  }

  return merged;
};

const subtractBusyFromWindow = (window: MsInterval, busy: MsInterval[]): MsInterval[] => {
  const free: MsInterval[] = [];
  let cursor = window.start;

  for (const interval of busy) {
    if (interval.end <= cursor || interval.start >= window.end) {
      continue;
    }
    if (interval.start > cursor) {
      free.push({ end: interval.start, start: cursor });
    }
    cursor = Math.min(Math.max(interval.end, cursor), window.end);
  }

  if (cursor < window.end) {
    free.push({ end: window.end, start: cursor });
  }

  return free;
};

const buildLocalDayStarts = (range: MsInterval, timeZone: string): number[] => {
  const startWall = instantToWallTime(new Date(range.start), timeZone);
  const endWall = instantToWallTime(new Date(range.end), timeZone);
  const firstDay = Date.UTC(
    startWall.getUTCFullYear(),
    startWall.getUTCMonth(),
    startWall.getUTCDate(),
  );
  const lastDay = Date.UTC(endWall.getUTCFullYear(), endWall.getUTCMonth(), endWall.getUTCDate());
  const dayStarts: number[] = [];

  for (let day = firstDay; day <= lastDay; day += MS_PER_DAY) {
    dayStarts.push(day);
  }

  return dayStarts;
};

const buildCandidateWindows = (
  range: MsInterval,
  timeZone: string,
  workingHours: WorkingHours | null,
): MsInterval[] => {
  if (!workingHours) {
    return [range];
  }

  return buildLocalDayStarts(range, timeZone)
    .filter((dayStart) => {
      if (!workingHours.days) {
        return true;
      }
      return workingHours.days.includes(new Date(dayStart).getUTCDay());
    })
    .map((dayStart) => ({
      end: wallTimeToInstant(
        new Date(dayStart + workingHours.endMinute * MS_PER_MINUTE),
        timeZone,
      ).getTime(),
      start: wallTimeToInstant(
        new Date(dayStart + workingHours.startMinute * MS_PER_MINUTE),
        timeZone,
      ).getTime(),
    }))
    .map((window) => ({
      end: Math.min(window.end, range.end),
      start: Math.max(window.start, range.start),
    }))
    .filter((window) => window.end > window.start);
};

const toFreeSlot = (interval: MsInterval): FreeSlot => ({
  durationMinutes: Math.floor((interval.end - interval.start) / MS_PER_MINUTE),
  end: new Date(interval.end).toISOString(),
  start: new Date(interval.start).toISOString(),
});

const findFreeSlots = (
  range: TimeInterval,
  busyIntervals: TimeInterval[],
  options: FreeTimeOptions,
): FreeSlot[] => {
  if (!Number.isInteger(options.durationMinutes) || options.durationMinutes <= 0) {
    throw new FreeTimeValidationError("durationMinutes must be a positive whole number of minutes");
  }
  if (!Number.isInteger(options.limit) || options.limit <= 0 || options.limit > MAX_FREE_SLOTS) {
    throw new FreeTimeValidationError(`limit must be a whole number from 1 to ${MAX_FREE_SLOTS}`);
  }

  const timeZone = resolveTimeZone(options.timezone);
  if (!timeZone) {
    throw new FreeTimeValidationError("timezone must be an IANA timezone identifier");
  }

  const msRange = toMsInterval(range);
  const busy = mergeIntervals(busyIntervals.map((interval) => toMsInterval(interval)));
  const minimumDurationMs = options.durationMinutes * MS_PER_MINUTE;

  return buildCandidateWindows(msRange, timeZone, options.workingHours)
    .flatMap((window) => subtractBusyFromWindow(window, busy))
    .filter((slot) => slot.end - slot.start >= minimumDurationMs)
    .toSorted((left, right) => left.start - right.start)
    .slice(0, options.limit)
    .map((slot) => toFreeSlot(slot));
};

export {
  DEFAULT_FREE_SLOTS,
  findFreeSlots,
  FreeTimeValidationError,
  MAX_FREE_SLOTS,
  mergeIntervals,
  parseWorkingHours,
  subtractBusyFromWindow,
};
export type { FreeSlot, FreeTimeOptions, TimeInterval, WorkingHours };
