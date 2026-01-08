import type { FC } from "react";
import clsx from "clsx";
import type { YearMonth } from "../hooks/use-calendar-grid";
import { isToday, formatDayNumber } from "../utils/date-calculations";

import { Geist_Mono } from "next/font/google";

const font = Geist_Mono();

interface CalendarDayCellProps {
  date: Date;
  size: number;
  centeredYearMonth: YearMonth;
}

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"]
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]

const CalendarDayCell: FC<CalendarDayCellProps> = ({ date, size, centeredYearMonth }) => {
  const today = isToday(date);
  const dayNumber = formatDayNumber(date);
  const monthNumber = date.getMonth();
  const year = date.getFullYear();

  const isInCenteredMonth =
    year === centeredYearMonth.year &&
    monthNumber === centeredYearMonth.month;

  const weekday = date.getDay()

  return (
    <div
      className={clsx(
        "flex flex-col justify-start p-2 first:border-l border-r border-b border-neutral-200",
        isInCenteredMonth ? "bg-neutral-50" : "bg-transparent",
        today && "bg-blue-50"
      )}
      style={{ width: size, height: size }}
    >
      <span
        className={clsx(
          font.className,
          "text-[10px] font-medium tabular-nums text-neutral-900",
          today && "text-blue-600 font-semibold"
        )}
      >
        {MONTHS[monthNumber]} {dayNumber.padStart(2, "0")} '{year.toString().slice(-2)}<br />
        {WEEKDAYS[weekday]}
      </span>
    </div>
  );
};

export { CalendarDayCell };
