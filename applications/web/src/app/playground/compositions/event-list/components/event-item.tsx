"use client";

import type { FC } from "react";
import { clsx } from "clsx";
import type { PlaygroundEvent } from "../utils/mock-events";
import { formatTimeUntil, isEventPast } from "../utils/time-utils";
import { ListItem } from "../../../components/list";

interface EventItemProps {
  event: PlaygroundEvent;
}

const EventItem: FC<EventItemProps> = ({ event }) => {
  const isPast = isEventPast(event.endTime);
  const timeUntil = formatTimeUntil(event.startTime);

  return (
    <ListItem id={event.id}>
      <div
        className={clsx(
          "flex items-center justify-between gap-4 text-xs w-full",
          isPast ? "text-neutral-400" : "text-neutral-700"
        )}
      >
        <div className="flex items-center gap-2 max-w-[50%] whitespace-nowrap">
          <span className={clsx("overflow-hidden text-ellipsis", isPast && "line-through")}>{event.name}</span>
          <span className="shrink-0 text-neutral-400">{event.sourceCalendar}</span>
        </div>
        <span className="shrink-0 tabular-nums">{timeUntil}</span>
      </div>
    </ListItem>
  );
};

export { EventItem };
