"use client";

import type { FC } from "react";
import { useId, useState } from "react";
import { EventItem } from "./components/event-item";
import type { PlaygroundEvent } from "./utils/mock-events";

interface EventListProps {
  events: PlaygroundEvent[];
}

const EventList: FC<EventListProps> = ({ events }) => {
  const indicatorLayoutId = useId();
  const [activeEventId, setActiveEventId] = useState<string | null>(null);

  return (
    <div className="flex flex-col">
      {events.map((event) => (
        <EventItem
          key={event.id}
          event={event}
          isActive={activeEventId === event.id}
          onMouseEnter={() => setActiveEventId(event.id)}
          onMouseLeave={() => setActiveEventId(null)}
          indicatorLayoutId={indicatorLayoutId}
        />
      ))}
    </div>
  );
};

export { EventList };
export type { EventListProps };
