import { useEffect, useRef, memo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { BackButton } from "../../../../components/ui/back-button";
import { ErrorState } from "../../../../components/ui/error-state";
import { Heading3 } from "../../../../components/ui/heading";
import { Text } from "../../../../components/ui/text";
import { formatTime, formatTimeUntil, isEventPast, formatDayHeader } from "../../../../lib/time";
import { useEvents, type CalendarEvent } from "../../../../hooks/use-events";

export const Route = createFileRoute("/(dashboard)/dashboard/events/")({
  component: RouteComponent,
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
    const existing = groups.get(key);
    if (existing) {
      existing.push(event);
    } else {
      groups.set(key, [event]);
    }
  }

  return [...groups.entries()].map(([key, dayEvents]) => ({
    label: formatDayHeader(new Date(key)),
    events: dayEvents,
  }));
};

function RouteComponent() {
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
    <div className="flex flex-col gap-3">
      {dayGroups.map((group) => (
        <DaySection key={group.label} label={group.label} events={group.events} />
      ))}
      {!hasMore && dayGroups.length === 0 && (
        <Text size="sm" tone="muted" align="center">
          No upcoming events.
        </Text>
      )}
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
  const observerRef = useRef<IntersectionObserver | null>(null);
  const isValidatingRef = useRef(isValidating);
  const hasMoreRef = useRef(hasMore);
  const onLoadMoreRef = useRef(onLoadMore);

  useEffect(() => {
    isValidatingRef.current = isValidating;
    hasMoreRef.current = hasMore;
    onLoadMoreRef.current = onLoadMore;
  });

  const observe = () => {
    const node = nodeRef.current;
    if (!node) return;

    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !isValidatingRef.current && hasMoreRef.current) {
          onLoadMoreRef.current();
        }
      },
      { rootMargin: "200px" },
    );

    observerRef.current.observe(node);
  };

  useEffect(() => {
    observe();
    return () => observerRef.current?.disconnect();
  }, []);

  useEffect(() => {
    if (!isValidating) observe();
  }, [isValidating]);

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
    <div className="flex flex-col gap-0.5">
      <Heading3 as="h3" className="font-sans text-sm">{label}</Heading3>
      <div className="flex flex-col">
        {events.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}, areDaySectionPropsEqual);

const EventRow = memo(function EventRow({ event }: EventRowProps) {
  const past = isEventPast(event.endTime);
  const startTime = formatTime(event.startTime);
  const endTime = formatTime(event.endTime);
  const timeUntil = formatTimeUntil(event.startTime);

  return (
    <div className={`flex items-center justify-between gap-2 py-1.5 ${past ? "line-through" : ""}`}>
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
