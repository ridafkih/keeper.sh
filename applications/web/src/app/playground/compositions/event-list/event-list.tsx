"use client";

import type { FC } from "react";
import { EventItem } from "./components/event-item";
import type { PlaygroundEvent } from "./utils/mock-events";
import { List } from "../../components/list";

interface EventListProps {
  events: PlaygroundEvent[];
}

const EventList: FC<EventListProps> = ({ events }) => (
  <List>
    {events.map((event) => (
      <EventItem key={event.id} event={event} />
    ))}
  </List>
);

export { EventList };
export type { EventListProps };
