"use client";

import type { FC } from "react";
import { useState } from "react";
import { MOCK_EVENTS } from "./utils/mock-events";
import { EventItem } from "./components/event-item";

const TodayEvents: FC = () => {
  const [activeEventId, setActiveEventId] = useState<string | null>(null);

  return (
    <div className="flex flex-col">
      {MOCK_EVENTS.map((event) => (
        <EventItem
          key={event.id}
          event={event}
          isActive={activeEventId === event.id}
          onMouseEnter={() => setActiveEventId(event.id)}
          onMouseLeave={() => setActiveEventId(null)}
        />
      ))}
    </div>
  );
};

export { TodayEvents };
