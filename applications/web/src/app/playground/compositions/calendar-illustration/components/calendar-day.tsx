import { FC } from "react";

import { hasEvents } from "../utils/events";
import { EventMarkerGroup } from "./event-marker-group";

type CalendarDayProps = {
  day: number;
  eventColors: string[];
};

export const CalendarDay: FC<CalendarDayProps> = ({ day, eventColors }) => (
  <div className="relative overflow-hidden aspect-square bg-neutral-50 p-1.5 flex flex-col">
    <div className="text-[0.625rem] text-neutral-500 text-center font-semibold">
      {day.toString()}
    </div>
    {hasEvents(eventColors) && <EventMarkerGroup colors={eventColors} />}
  </div>
);
