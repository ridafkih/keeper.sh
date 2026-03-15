import { useEffect, useRef, memo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import { BackButton } from "@/components/ui/primitives/back-button";
import { ErrorState } from "@/components/ui/primitives/error-state";
import { DashboardHeading1, DashboardHeading2 } from "@/components/ui/primitives/dashboard-heading";
import { Text } from "@/components/ui/primitives/text";
import { formatTime, formatTimeUntil, isEventPast, formatDayHeader } from "@/lib/time";
import { useEvents, type CalendarEvent } from "@/hooks/use-events";
import { cn } from "@/utils/cn";

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

interface EventRowProps {
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

const areDaySectionPropsEqual = (prev: DaySectionProps, next: DaySectionProps): boolean => {
  if (prev.label !== next.label) return false;
  if (prev.events.length !== next.events.length) return false;
  return prev.events.every((event, index) => event.id === next.events[index].id);
};

const DaySection = memo(function DaySection({ label, events }: DaySectionProps) {
  return (
    <div className="flex flex-col px-0.5">
      <DashboardHeading2>{label}</DashboardHeading2>
      <div className="flex flex-col">
        {events.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}, areDaySectionPropsEqual);

function resolveEventRowClassName(past: boolean): string {
  return cn("flex items-center justify-between gap-2 py-1.5", past && "line-through");
}

const EventRow = memo(function EventRow({ event }: EventRowProps) {
  const past = isEventPast(event.endTime);
  const startTime = formatTime(event.startTime);
  const endTime = formatTime(event.endTime);
  const timeUntil = formatTimeUntil(event.startTime);

  return (
    <div className={resolveEventRowClassName(past)}>
      <div className="flex items-center gap-1 min-w-0">
        <Text size="sm" tone="muted" className="truncate">
          {event.calendarName}
        </Text>
        <Text size="sm" tone="muted" className="shrink-0">
          from
        </Text>
        <Text size="sm" tone="default" className="font-medium tabular-nums shrink-0">
          {startTime}
        </Text>
        <Text size="sm" tone="muted" className="shrink-0">
          to
        </Text>
        <Text size="sm" tone="default" className="font-medium tabular-nums shrink-0">
          {endTime}
        </Text>
      </div>
      <Text size="sm" tone="muted" className="tabular-nums shrink-0 whitespace-nowrap">
        {timeUntil}
      </Text>
    </div>
  );
});
