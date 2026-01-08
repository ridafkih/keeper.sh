"use client";

import type { FC } from "react";
import { useCalendarGrid } from "../hooks/use-calendar-grid";
import { CalendarWeekRow } from "./calendar-week-row";
import type { WeekStartDay } from "../utils/date-calculations";

interface CalendarGridContainerProps {
  weekStartDay?: WeekStartDay;
}

const CalendarGridContainer: FC<CalendarGridContainerProps> = ({
  weekStartDay = 0,
}) => {
  const { parentRef, virtualizer, getWeekDates, cellSize, centeredYearMonth } = useCalendarGrid({
    overscan: 5,
    weekStartDay,
  });

  const virtualRows = virtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      className="h-full w-full overflow-auto"
      style={{ contain: "strict" }}
    >
      <div
        className="relative w-full"
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          background: "repeating-linear-gradient(45deg, var(--color-neutral-50), var(--color-neutral-50) 6px, var(--color-neutral-100) 6px, var(--color-neutral-100) calc(6px * 2))",
        }}
      >
        {virtualRows.map((virtualRow) => {
          const dates = getWeekDates(virtualRow.index);
          return (
            <CalendarWeekRow
              key={virtualRow.key}
              virtualRow={virtualRow}
              dates={dates}
              cellSize={cellSize}
              centeredYearMonth={centeredYearMonth}
            />
          );
        })}
      </div>
    </div>
  );
};

export { CalendarGridContainer };
