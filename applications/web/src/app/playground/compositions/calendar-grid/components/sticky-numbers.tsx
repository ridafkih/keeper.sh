"use client";

import type { FC } from "react";
import { useFirstVisibleRowIndex } from "../contexts/calendar-grid-context";
import { getStartDate } from "../utils/date-utils";
import { COLUMN_COUNT } from "../utils/constants";

const startDate = getStartDate();

const StickyNumbers: FC = () => {
  const firstVisibleRowIndex = useFirstVisibleRowIndex();

  const days = [...Array(COLUMN_COUNT)].map((_, colIndex) => {
    const daysFromStart = firstVisibleRowIndex * COLUMN_COUNT + colIndex;
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + daysFromStart);
    return date.getDate();
  });

  return (
    <div className="sticky top-0 z-10 grid grid-cols-7 pointer-events-none">
      {days.map((day, colIndex) => (
        <div key={colIndex} className="p-3 text-xs text-neutral-600">
          {day}
        </div>
      ))}
    </div>
  );
};

export { StickyNumbers };
