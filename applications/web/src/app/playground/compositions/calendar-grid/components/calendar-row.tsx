"use client";

import type { FC } from "react";
import { memo } from "react";
import { CalendarCell } from "./calendar-cell";
import { COLUMN_COUNT } from "../utils/constants";

interface CalendarRowProps {
  rowIndex: number;
  rowHeight: number;
  startY: number;
  startDate: Date;
}

const CalendarRow: FC<CalendarRowProps> = memo(
  ({ rowIndex, rowHeight, startY, startDate }) => (
    <div
      className="absolute left-0 right-0 grid grid-cols-7 gap-px"
      style={{
        height: `${rowHeight}px`,
        transform: `translateY(${startY}px)`,
      }}
    >
      {[...Array(COLUMN_COUNT)].map((_, colIndex) => {
        const daysFromStart = rowIndex * COLUMN_COUNT + colIndex;
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + daysFromStart);
        return <CalendarCell key={colIndex} day={date.getDate()} />;
      })}
    </div>
  ),
  (prev, next) =>
    prev.rowIndex === next.rowIndex &&
    prev.rowHeight === next.rowHeight &&
    prev.startY === next.startY &&
    prev.startDate.getTime() === next.startDate.getTime()
);

CalendarRow.displayName = "CalendarRow";

export { CalendarRow };
