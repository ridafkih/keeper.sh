import { useEffect, useRef, memo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import { BackButton } from "@/components/ui/primitives/back-button";
import { ErrorState } from "@/components/ui/primitives/error-state";
import { DashboardHeading1, DashboardHeading2 } from "@/components/ui/primitives/dashboard-heading";
import { Text } from "@/components/ui/primitives/text";
import { isEventPast, formatDayHeader } from "@/lib/time";
import { EventCard } from "@/features/dashboard/components/event-card";
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
      <div className="flex flex-col gap-2 pt-1">
        {events.map((event) => (
          <EventCard key={event.id} event={event} past={isEventPast(event.endTime)} />
        ))}
      </div>
    </div>
  );
});
