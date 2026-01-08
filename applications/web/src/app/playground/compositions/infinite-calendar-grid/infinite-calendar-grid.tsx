"use client";

import type { FC } from "react";
import { CalendarGridContainer } from "./components/calendar-grid-container";
import type { WeekStartDay } from "./utils/date-calculations";

interface InfiniteCalendarGridProps {
  weekStartDay?: WeekStartDay;
}

const InfiniteCalendarGrid: FC<InfiniteCalendarGridProps> = ({
  weekStartDay = 0,
}) => <CalendarGridContainer weekStartDay={weekStartDay} />;

export { InfiniteCalendarGrid };
