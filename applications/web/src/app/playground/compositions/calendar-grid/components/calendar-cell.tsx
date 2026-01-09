"use client";

import type { FC } from "react";
import { memo } from "react";

interface CalendarCellProps {
  day: number;
}

const CalendarCell: FC<CalendarCellProps> = memo(({ day }) => (
  <div className="bg-neutral-50 size-full p-3 text-xs text-neutral-600 flex flex-col justify-end">
    {day}
  </div>
));

CalendarCell.displayName = "CalendarCell";

export { CalendarCell };
