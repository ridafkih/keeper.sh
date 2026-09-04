import { useEffect, useRef, useState, memo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { LazyMotion, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { loadMotionFeatures } from "@/lib/motion-features";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import { BackButton } from "@/components/ui/primitives/back-button";
import { ErrorState } from "@/components/ui/primitives/error-state";
import { ScrollFader } from "@/components/ui/primitives/scroll-fader";
import { StickyPageHeader } from "@/components/ui/primitives/sticky-page-header";
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
  startIndex: number;
  firstNewIndex: number;
  reduceMotion: boolean;
}

const CARD_HIDDEN = { opacity: 0, y: 8 };
const CARD_VISIBLE = { opacity: 1, y: 0 };
const CARD_TRANSITION = { duration: 0.28, ease: [0.2, 0, 0, 1] as const };
const CARD_STAGGER = 0.035;
const CARD_STAGGER_CAP = 12;
const INSTANT = { duration: 0 };

function resolveCardTransition(order: number, reduceMotion: boolean) {
  if (reduceMotion) return INSTANT;
  return { ...CARD_TRANSITION, delay: Math.min(order, CARD_STAGGER_CAP) * CARD_STAGGER };
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

const resolveGroupOffsets = (groups: DayGroup[]): number[] => {
  let offset = 0;
  return groups.map((group) => {
    const start = offset;
    offset += group.events.length;
    return start;
  });
};

function EventsPage() {
  return (
    <ScrollFader>
      <div className="flex flex-col gap-3">
        <EventsHeader />
        <EventsContent />
      </div>
    </ScrollFader>
  );
}

function EventsHeader() {
  return (
    <StickyPageHeader className="gap-3">
      <BackButton />
      <div className="flex flex-col">
        <DashboardHeading1>Events</DashboardHeading1>
        <Text size="sm">View all of the events across all of your calendars.</Text>
      </div>
    </StickyPageHeader>
  );
}

function EventsContent() {
  const { events, error, isLoading, isValidating, hasMore, loadMore } = useEvents();
  const reduceMotion = useReducedMotion() ?? false;
  // Cards already on screen when the page mounts (cached data) stay put; only newly fetched ones rise in.
  const [revealed, setRevealed] = useState({ count: isLoading ? 0 : events.length, seen: events.length });
  if (revealed.seen !== events.length) {
    setRevealed({ count: revealed.seen, seen: events.length });
  }
  const dayGroups = groupEventsByDay(events);
  const groupOffsets = resolveGroupOffsets(dayGroups);

  if (isLoading) return <LoadingIndicator />;
  if (error) return <ErrorState message="Failed to load events." />;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-4">
        <LazyMotion features={loadMotionFeatures}>
          {dayGroups.map((group, groupIndex) => (
            <DaySection
              key={group.label}
              label={group.label}
              events={group.events}
              startIndex={groupOffsets[groupIndex]}
              firstNewIndex={revealed.count}
              reduceMotion={reduceMotion}
            />
          ))}
        </LazyMotion>
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

const DaySection = memo(function DaySection({
  label,
  events,
  startIndex,
  firstNewIndex,
  reduceMotion,
}: DaySectionProps) {
  return (
    <div className="flex flex-col px-0.5">
      <DashboardHeading2>{label}</DashboardHeading2>
      <div className="flex flex-col gap-2 pt-1">
        {events.map((event, eventIndex) => {
          const order = startIndex + eventIndex - firstNewIndex;
          return (
            <m.div
              key={event.id}
              initial={order < 0 ? false : CARD_HIDDEN}
              animate={CARD_VISIBLE}
              transition={resolveCardTransition(Math.max(order, 0), reduceMotion)}
            >
              <EventCard event={event} past={isEventPast(event.endTime)} />
            </m.div>
          );
        })}
      </div>
    </div>
  );
});
