import { FC } from "react";

import { type EventRecord, getEventColorsForDayIfVisible } from "../utils/events";
import { createGridIndices, indexToDayNumber } from "../utils/calendar-grid";
import { CalendarDay } from "./calendar-day";

export type CalendarGridProps = {
  events: EventRecord;
  columns?: number;
  rows?: number;
  daysInMonth?: number;
};

export const CalendarGrid: FC<CalendarGridProps> = ({
  events,
  columns = 7,
  rows = 5,
  daysInMonth = 31,
}) => {
  const indices = createGridIndices(columns, rows);

  return (
    <div className="grid grid-cols-7 gap-0.5 overflow-hidden rounded-xl">
      {indices.map((index) => {
        const dayNumber = indexToDayNumber(index, daysInMonth);
        const eventColors = getEventColorsForDayIfVisible(events, dayNumber, index, daysInMonth - 1);

        return <CalendarDay key={index} day={dayNumber} eventColors={eventColors} />;
      })}
    </div>
  );
};
