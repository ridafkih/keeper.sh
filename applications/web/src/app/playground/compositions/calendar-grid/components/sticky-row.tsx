"use client";

import type { FC } from "react";
import { useFirstVisibleRowIndex, useRowHeight } from "../contexts/calendar-grid-context";
import { getStartDate } from "../utils/date-utils";
import { COLUMN_COUNT } from "../utils/constants";
import { CalendarCell } from "./calendar-cell";

const startDate = getStartDate();

const StickyRow: FC = () => {
  const firstVisibleRowIndex = useFirstVisibleRowIndex();
  const rowHeight = useRowHeight();

  return (
    <div
      className="sticky top-0 z-10 grid grid-cols-7 gap-px bg-neutral-300"
      style={{ height: `${rowHeight}px` }}
    >
      {[...Array(COLUMN_COUNT)].map((_, colIndex) => {
        const daysFromStart = firstVisibleRowIndex * COLUMN_COUNT + colIndex;
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + daysFromStart);
        return <CalendarCell key={colIndex} day={date.getDate()} />;
      })}
    </div>
  );
};

export { StickyRow };
