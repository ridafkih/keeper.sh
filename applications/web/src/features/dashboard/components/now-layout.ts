import { formatClock } from "@/lib/time";
import { HOUR_HEIGHT, HOURS, isSameDay } from "./calendar-helpers";
import { timeOfDayFraction } from "./event-layout";

export const NOW_PILL_HEIGHT_PX = 14;
const HOUR_LABEL_HEIGHT_PX = 10;
/** A label the pill would only half-cover is hidden instead. */
const NOW_PILL_CLEARANCE_PX = (NOW_PILL_HEIGHT_PX + HOUR_LABEL_HEIGHT_PX) / 2;

export interface NowLayout {
  label: string;
  topFraction: number;
  today: { left: number; width: number } | null;
  coveredHour: number | null;
}

export function resolveNowLayout(days: Date[], now: Date): NowLayout {
  const topFraction = timeOfDayFraction(now);
  const hourPosition = topFraction * HOURS.length;
  const nearestHour = Math.round(hourPosition);
  const covered = Math.abs(hourPosition - nearestHour) * HOUR_HEIGHT < NOW_PILL_CLEARANCE_PX;
  const todayIndex = days.findIndex((day) => isSameDay(day, now));

  return {
    label: formatClock(now),
    topFraction,
    today: todayIndex === -1 ? null : { left: todayIndex / days.length, width: 1 / days.length },
    coveredHour: covered ? nearestHour : null,
  };
}
