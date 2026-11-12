import { formatDayHeader } from "@/lib/time";
import { resolveEventLocalStart, resolveEventStartDay } from "@/lib/event-day";
import type { CalendarEvent } from "@/hooks/use-events";

export interface DayGroup {
  label: string;
  events: CalendarEvent[];
}

const compareLocalStart = (left: CalendarEvent, right: CalendarEvent): number =>
  resolveEventLocalStart(left).getTime() - resolveEventLocalStart(right).getTime();

export const groupEventsByDay = (events: CalendarEvent[]): DayGroup[] => {
  const groups = new Map<number, CalendarEvent[]>();

  for (const event of [...events].sort(compareLocalStart)) {
    const key = resolveEventStartDay(event).getTime();
    const dayEvents = groups.get(key) ?? [];
    dayEvents.push(event);
    groups.set(key, dayEvents);
  }

  return [...groups.entries()].map(([key, dayEvents]) => ({
    label: formatDayHeader(new Date(key)),
    events: dayEvents,
  }));
};
