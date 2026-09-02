import { HOUR_HEIGHT, HOURS, isSameDay } from "./calendar-helpers";
import { timeOfDayFraction } from "./event-layout";

/** Pill half-height plus label half-height: a label the pill would only half-cover is hidden instead. */
const NOW_PILL_CLEARANCE_PX = 12;

export interface NowLayout {
  topFraction: number;
  todayIndex: number;
  coveredHour: number | null;
}

export function resolveNowLayout(days: Date[], now: Date): NowLayout {
  const topFraction = timeOfDayFraction(now);
  const hourPosition = topFraction * HOURS.length;
  const nearestHour = Math.round(hourPosition);
  const covered = Math.abs(hourPosition - nearestHour) * HOUR_HEIGHT < NOW_PILL_CLEARANCE_PX;

  return {
    topFraction,
    todayIndex: days.findIndex((day) => isSameDay(day, now)),
    coveredHour: covered ? nearestHour : null,
  };
}
