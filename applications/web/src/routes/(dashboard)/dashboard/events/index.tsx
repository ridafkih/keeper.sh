import { useEffect, useRef, memo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { tv } from "tailwind-variants/lite";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import { BackButton } from "@/components/ui/primitives/back-button";
import { ErrorState } from "@/components/ui/primitives/error-state";
import { DashboardHeading1, DashboardHeading2 } from "@/components/ui/primitives/dashboard-heading";
import { Text } from "@/components/ui/primitives/text";
import { formatTime, formatTimeUntil, isEventPast, formatDayHeader } from "@/lib/time";
import { useEvents, type CalendarEvent } from "@/hooks/use-events";

export const Route = createFileRoute("/(dashboard)/dashboard/events/")({
  component: EventsPage,
});

interface DayGroup {
  label: string;
  events: CalendarEvent[];
}

interface DaySectionProps {
  label: string;
  events: CalendarEvent[];
}

interface EventCardProps {
  event: CalendarEvent;
}

interface LoadMoreSentinelProps {
  isValidating: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}

const groupEventsByDay = (events: CalendarEvent[]): DayGroup[] => {
  const groups = new Map<string, CalendarEvent[]>();

  for (const event of events) {
    const key = event.startTime.toDateString();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(event);
  }

  return [...groups.entries()].map(([key, dayEvents]) => ({
    label: formatDayHeader(new Date(key)),
    events: dayEvents,
  }));
};

function EventsPage() {
  return (
    <div className="flex flex-col gap-3">
      <BackButton />
      <EventsContent />
    </div>
  );
}

function EventsContent() {
  const { events, error, isLoading, isValidating, hasMore, loadMore } = useEvents();
  const dayGroups = groupEventsByDay(events);

  if (isLoading) return <LoadingIndicator />;
  if (error) return <ErrorState message="Failed to load events." />;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col">
          <DashboardHeading1>Events</DashboardHeading1>
          <Text size="sm">View all of the events across all of your calendars.</Text>
        </div>
        {dayGroups.map((group) => (
          <DaySection key={group.label} label={group.label} events={group.events} />
        ))}
      </div>
      {hasMore && (
        <LoadMoreSentinel
          isValidating={isValidating}
          hasMore={hasMore}
          onLoadMore={loadMore}
        />
      )}
    </div>
  );
}

function LoadMoreSentinel({ isValidating, hasMore, onLoadMore }: LoadMoreSentinelProps) {
  const nodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node || isValidating || !hasMore) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) onLoadMore();
      },
      { rootMargin: "200px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [isValidating, hasMore, onLoadMore]);

  return (
    <div ref={nodeRef} className="flex justify-center py-2">
      {isValidating && (
        <LoaderCircle size={16} className="animate-spin text-foreground-muted" />
      )}
    </div>
  );
}

function LoadingIndicator() {
  return (
    <div className="flex justify-center py-6">
      <LoaderCircle size={20} className="animate-spin text-foreground-muted" />
    </div>
  );
}

const DaySection = memo(function DaySection({ label, events }: DaySectionProps) {
  return (
    <div className="flex flex-col px-0.5">
      <DashboardHeading2>{label}</DashboardHeading2>
      <div className="flex flex-col">
        {events.map((event) => (
          <EventCard key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
});

const eventCard = tv({
  base: "relative flex flex-col gap-0.5 overflow-hidden rounded-xl bg-event-background py-2.5 pr-3 pl-4 before:absolute before:inset-y-2 before:left-1.5 before:w-0.5 before:rounded-full before:bg-event-border",
  variants: {
    past: {
      true: "opacity-60 line-through",
      false: "",
    },
  },
});

const EventCard = memo(function EventCard({ event }: EventCardProps) {
  const past = isEventPast(event.endTime);
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
