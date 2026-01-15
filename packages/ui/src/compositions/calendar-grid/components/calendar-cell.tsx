"use client";

import type { FC } from "react";
import { memo } from "react";

interface CalendarCellProps {
  day: number;
}

const CalendarCell: FC<CalendarCellProps> = memo(({ day }) => (
  <div className="bg-surface-subtle size-full p-3 text-xs text-foreground-secondary flex flex-col justify-end">
    {day}
  </div>
));

CalendarCell.displayName = "CalendarCell";

export { CalendarCell };
