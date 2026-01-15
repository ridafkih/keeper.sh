import type { FC } from "react";

import { hasEvents } from "../utils/events";
import { EventMarkerGroup } from "./event-marker-group";

interface CalendarDayProps {
  day: number;
  eventColors: string[];
}

const CalendarDay: FC<CalendarDayProps> = ({ day, eventColors }) => (
  <div className="relative overflow-hidden aspect-square bg-surface-subtle p-1.5 flex flex-col">
    <div className="text-[0.625rem] text-foreground-muted text-center font-semibold">
      {day.toString()}
    </div>
    {hasEvents(eventColors) && <EventMarkerGroup colors={eventColors} />}
  </div>
);

export { CalendarDay };
