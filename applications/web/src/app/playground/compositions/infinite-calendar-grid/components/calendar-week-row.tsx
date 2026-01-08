import type { FC } from "react";
import type { VirtualItem } from "@tanstack/react-virtual";
import type { YearMonth } from "../hooks/use-calendar-grid";
import { CalendarDayCell } from "./calendar-day-cell";

interface CalendarWeekRowProps {
  virtualRow: VirtualItem;
  dates: Date[];
  cellSize: number;
  centeredYearMonth: YearMonth;
}

const CalendarWeekRow: FC<CalendarWeekRowProps> = ({ virtualRow, dates, cellSize, centeredYearMonth }) => (
  <div
    className="flex absolute top-0 left-0 w-full"
    style={{
      height: cellSize,
      transform: `translateY(${virtualRow.start}px)`,
    }}
  >
    {dates.map((date) => (
      <CalendarDayCell
        key={date.toISOString()}
        date={date}
        size={cellSize}
        centeredYearMonth={centeredYearMonth}
      />
    ))}
  </div>
);

export { CalendarWeekRow };
