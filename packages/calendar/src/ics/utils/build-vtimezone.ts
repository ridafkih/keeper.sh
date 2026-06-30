import type { IcsRecurrenceRule, IcsTimezone, IcsTimezoneProp } from "ts-ics";
import { normalizeTimezone } from "./normalize-timezone";

const MS_PER_MINUTE = 60 * 1000;
const MINUTES_PER_HOUR = 60;
const HOURS_IN_DAY = 24;
const MS_PER_DAY = HOURS_IN_DAY * MINUTES_PER_HOUR * MS_PER_MINUTE;
const DAYS_OF_WEEK = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

interface Transition {
  instant: number;
  offsetFrom: number;
  offsetTo: number;
}

const offsetMinutesAt = (instantMs: number, timeZone: string): number => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const lookup = new Map<string, string>();
  for (const part of formatter.formatToParts(instantMs)) {
    lookup.set(part.type, part.value);
  }
  const read = (type: string): number => Number.parseInt(lookup.get(type) ?? "0", 10);

  let hour = read("hour");
  if (hour === HOURS_IN_DAY) {
    hour = 0;
  }

  const wallClockAsUtc = Date.UTC(read("year"), read("month") - 1, read("day"), hour, read("minute"), read("second"));
  return Math.round((wallClockAsUtc - instantMs) / MS_PER_MINUTE);
};

const findTransitionInstant = (loMs: number, hiMs: number, timeZone: string, offsetFrom: number): number => {
  let lo = loMs;
  let hi = hiMs;
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsetMinutesAt(mid, timeZone) === offsetFrom) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return hi;
};

const findTransitions = (timeZone: string, referenceInstant: Date): Transition[] => {
  const year = referenceInstant.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);

  const transitions: Transition[] = [];
  let previousOffset = offsetMinutesAt(start, timeZone);

  for (let dayMs = start + MS_PER_DAY; dayMs <= end; dayMs += MS_PER_DAY) {
    const currentOffset = offsetMinutesAt(dayMs, timeZone);
    if (currentOffset === previousOffset) {
      continue;
    }
    const instant = findTransitionInstant(dayMs - MS_PER_DAY, dayMs, timeZone, previousOffset);
    transitions.push({ instant, offsetFrom: previousOffset, offsetTo: currentOffset });
    previousOffset = currentOffset;
  }

  return transitions;
};

const padTwo = (value: number): string => Math.trunc(value).toString().padStart(2, "0");

const formatOffset = (minutes: number): string => {
  let sign = "+";
  if (minutes < 0) {
    sign = "-";
  }
  const absolute = Math.abs(minutes);
  return `${sign}${padTwo(Math.floor(absolute / MINUTES_PER_HOUR))}${padTwo(absolute % MINUTES_PER_HOUR)}`;
};

const buildRecurrenceRule = (localOnset: Date): IcsRecurrenceRule => {
  const month = localOnset.getUTCMonth();
  const dayOfMonth = localOnset.getUTCDate();
  const weekday = DAYS_OF_WEEK[localOnset.getUTCDay()];
  const daysInMonth = new Date(Date.UTC(localOnset.getUTCFullYear(), month + 1, 0)).getUTCDate();
  const isLastWeekday = dayOfMonth + DAYS_OF_WEEK.length > daysInMonth;

  let occurrence = Math.floor((dayOfMonth - 1) / DAYS_OF_WEEK.length) + 1;
  if (isLastWeekday) {
    occurrence = -1;
  }

  return {
    frequency: "YEARLY",
    byMonth: [month],
    byDay: [{ day: weekday, occurrence }],
  } as IcsRecurrenceRule;
};

const buildObservance = (transition: Transition): IcsTimezoneProp => {
  const localOnsetMs = transition.instant + transition.offsetFrom * MS_PER_MINUTE;
  const start = new Date(localOnsetMs - transition.offsetTo * MS_PER_MINUTE);

  let type: IcsTimezoneProp["type"] = "STANDARD";
  if (transition.offsetTo > transition.offsetFrom) {
    type = "DAYLIGHT";
  }

  return {
    type,
    start,
    offsetFrom: formatOffset(transition.offsetFrom),
    offsetTo: formatOffset(transition.offsetTo),
    recurrenceRule: buildRecurrenceRule(new Date(localOnsetMs)),
  };
};

const buildFixedObservance = (offsetMinutes: number): IcsTimezoneProp => {
  const offset = formatOffset(offsetMinutes);
  return {
    type: "STANDARD",
    start: new Date(Date.UTC(1970, 0, 1) - offsetMinutes * MS_PER_MINUTE),
    offsetFrom: offset,
    offsetTo: offset,
  };
};

const isValidTimeZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
};

const buildVtimezone = (timezone: string | undefined, referenceInstant: Date): IcsTimezone | undefined => {
  const resolved = normalizeTimezone(timezone);
  if (!resolved || !isValidTimeZone(resolved)) {
    return;
  }

  const transitions = findTransitions(resolved, referenceInstant);
  if (transitions.length === 2) {
    const recurringObservances = transitions.map((transition) => buildObservance(transition));
    // Ts-ics can expand both recurrence rules to an empty list.
    // Keep a baseline offset available for dates before the first matching onset.
    const baselineObservance = buildFixedObservance(transitions[0]?.offsetFrom ?? 0);
    return { id: resolved, props: [...recurringObservances, baselineObservance] };
  }

  const offset = offsetMinutesAt(referenceInstant.getTime(), resolved);
  return { id: resolved, props: [buildFixedObservance(offset)] };
};

export { buildVtimezone };
