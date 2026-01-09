"use client";

import type { FC } from "react";
import type { VirtualItem } from "@tanstack/react-virtual";
import { useRowHeight } from "../contexts/calendar-grid-context";
import { getSundayBeforeMonthStart, getDateForCell, getMonthLetter, shouldShowMonthIndicator } from "../utils/date-utils";

const startDate = getSundayBeforeMonthStart();

interface MonthColumnProps {
  monthColumnRef: React.RefObject<HTMLDivElement | null>;
  virtualRows: VirtualItem[];
}

const MonthColumn: FC<MonthColumnProps> = ({ monthColumnRef, virtualRows }) => {
  const rowHeight = useRowHeight();

  return (
    <div className="absolute -left-6 top-0 bottom-0 w-4 overflow-hidden">
      <div ref={monthColumnRef} className="absolute inset-x-0">
        {virtualRows.map((virtualRow) => (
          <div
            key={virtualRow.key}
            className="absolute left-0 right-0 flex items-center justify-center text-[10px] text-neutral-400"
            style={{
              height: `${rowHeight}px`,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {shouldShowMonthIndicator(startDate, virtualRow.index) &&
              getMonthLetter(getDateForCell(startDate, virtualRow.index, 0).getMonth())}
          </div>
        ))}
      </div>
    </div>
  );
};

export { MonthColumn };
