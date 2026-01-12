"use client";

import type { FC } from "react";
import { tv } from "tailwind-variants";
import type { PlaygroundEvent } from "../utils/mock-events";
import { formatTimeUntil, isEventPast } from "../utils/time-utils";
import { ListItem } from "../../../components/list";

interface EventItemProps {
  event: PlaygroundEvent;
}

const eventItemVariants = tv({
  slots: {
    container: "flex items-center justify-between gap-4 text-xs w-full",
    name: "overflow-hidden text-ellipsis",
  },
  variants: {
    isPast: {
      true: {
        container: "text-neutral-400",
        name: "line-through",
      },
      false: {
        container: "text-neutral-700",
      },
    },
  },
  defaultVariants: {
    isPast: false,
  },
});

const EventItem: FC<EventItemProps> = ({ event }) => {
  const isPast = isEventPast(event.endTime);
  const timeUntil = formatTimeUntil(event.startTime);
  const { container, name } = eventItemVariants({ isPast });

  return (
    <ListItem id={event.id}>
      <div className={container()}>
        <div className="flex items-center gap-2 max-w-[50%] whitespace-nowrap">
          <span className={name()}>{event.name}</span>
          <span className="shrink-0 text-neutral-400">{event.sourceCalendar}</span>
        </div>
        <span className="shrink-0 tabular-nums">{timeUntil}</span>
      </div>
    </ListItem>
  );
};

export { EventItem };
