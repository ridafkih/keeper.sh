import type { FC } from "react";
import clsx from "clsx";
import { getWeekdayHeaders, type WeekStartDay } from "../utils/date-calculations";

interface CalendarHeaderProps {
  weekStartDay?: WeekStartDay;
}

const CalendarHeader: FC<CalendarHeaderProps> = ({ weekStartDay = 0 }) => {
  const headers = getWeekdayHeaders(weekStartDay);

  return (
    <div className="flex border-b border-neutral-200 bg-white sticky top-0 z-10">
      {headers.map((day, index) => {
        const isWeekend =
          (weekStartDay === 0 && (index === 0 || index === 6)) ||
          (weekStartDay === 1 && (index === 5 || index === 6));

        return (
          <div
            key={day}
            className={clsx(
              "flex-1 py-2 text-center text-xs font-semibold uppercase tracking-wider",
              isWeekend ? "text-neutral-400" : "text-neutral-600"
            )}
          >
            {day}
          </div>
        );
      })}
    </div>
  );
};

export { CalendarHeader };
