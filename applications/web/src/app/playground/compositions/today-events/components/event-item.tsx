"use client";

import type { FC } from "react";
import { clsx } from "clsx";
import type { PlaygroundEvent } from "../utils/mock-events";
import { formatTimeUntil, isEventPast } from "../utils/time-utils";
import { EventIndicator } from "./event-indicator";

interface EventItemProps {
  event: PlaygroundEvent;
  isActive: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

const EventItem: FC<EventItemProps> = ({ event, isActive, onMouseEnter, onMouseLeave }) => {
  const isPast = isEventPast(event.endTime);
  const timeUntil = formatTimeUntil(event.startTime);

  return (
    <div
      className="relative -mx-4 px-4 py-2 cursor-default"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <EventIndicator isActive={isActive} />
      <div
        className={clsx(
          "relative z-10 flex items-center justify-between gap-4 text-xs",
          isPast ? "text-neutral-400" : "text-neutral-700"
        )}
      >
        <div className="flex items-center gap-2 max-w-[50%] whitespace-nowrap">
          <span className={clsx("overflow-hidden text-ellipsis", isPast && "line-through")}>{event.name}</span>
          <span className="shrink-0 text-neutral-400">{event.sourceCalendar}</span>
        </div>
        <span className="shrink-0 tabular-nums">{timeUntil}</span>
      </div>
    </div>
  );
};

export { EventItem };
