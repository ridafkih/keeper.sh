"use client";

import type { FC } from "react";
import type { VirtualItem } from "@tanstack/react-virtual";
import { CalendarRow } from "./calendar-row";
import { useCalendarVirtualizer, useRowHeight } from "../contexts/calendar-grid-context";
import { getStartDate } from "../utils/date-utils";

const startDate = getStartDate();

interface CalendarVirtualRowsProps {
  virtualRows: VirtualItem[];
}

const CalendarVirtualRows: FC<CalendarVirtualRowsProps> = ({ virtualRows }) => {
  const virtualizer = useCalendarVirtualizer();
  const rowHeight = useRowHeight();

  return (
    <div
      className="relative w-full"
      style={{ height: `${virtualizer.getTotalSize()}px` }}
    >
      {virtualRows.map((virtualRow) => (
        <CalendarRow
          key={virtualRow.key}
          rowIndex={virtualRow.index}
          rowHeight={rowHeight}
          startY={virtualRow.start}
          startDate={startDate}
        />
      ))}
    </div>
  );
};

export { CalendarVirtualRows };
