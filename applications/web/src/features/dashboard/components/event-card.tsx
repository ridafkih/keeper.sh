import { memo } from "react";
import { tv } from "tailwind-variants/lite";
import { Text } from "@/components/ui/primitives/text";
import { formatTime, formatTimeUntil } from "@/lib/time";
import type { CalendarEvent } from "@/hooks/use-events";

interface EventCardProps {
  event: CalendarEvent;
  /** Whether the event has ended, which dims and strikes the card. Owned by
   * the parent rather than read from the clock here: the card is memoised, so
   * a clock read inside it would freeze at first render, while the parent
   * re-renders on whatever tick it already has (the events list on a data
   * refresh, the week grid's today column on its minute tick). */
  past: boolean;
}

const eventCard = tv({
  base: "relative flex flex-col gap-0.5 overflow-hidden rounded-xl bg-event-background py-2.5 pr-3 pl-4 before:absolute before:inset-y-2 before:left-1.5 before:w-0.5 before:rounded-full before:bg-event-border",
  variants: {
    past: {
      true: "opacity-60 line-through",
      false: "",
    },
  },
});

/**
 * A tinted event card: time range and relative time on the first line, a
 * bold title (falling back to the calendar name), and the description when
 * the calendar shares it. Shared by the events page and the calendar pane.
 */
export const EventCard = memo(function EventCard({ event, past }: EventCardProps) {
  const startTime = formatTime(event.startTime);
  const endTime = formatTime(event.endTime);
  const timeUntil = formatTimeUntil(event.startTime);
  const title = event.title ?? event.calendarName;

  return (
    <div className={eventCard({ past })}>
      <div className="flex items-center justify-between gap-2">
        <Text size="sm" tone="eventMuted" className="tabular-nums">
          {startTime} - {endTime}
        </Text>
        <Text size="xs" tone="eventMuted" className="tabular-nums whitespace-nowrap">
          {timeUntil}
        </Text>
      </div>
      <Text size="sm" tone="event" className="truncate font-semibold">
        {title}
      </Text>
      {event.description && (
        <Text size="sm" tone="eventMuted" className="line-clamp-2">
          {event.description}
        </Text>
      )}
    </div>
  );
});
