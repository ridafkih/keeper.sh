import { useEffect, useRef, useState, memo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { LazyMotion, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { loadMotionFeatures } from "@/lib/motion-features";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import { BackButton } from "@/components/ui/primitives/back-button";
import { ErrorState } from "@/components/ui/primitives/error-state";
import { PageBody } from "@/components/ui/primitives/page-body";
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
  newOrders: ReadonlyMap<string, number>;
}

interface SeenIds {
  previous: ReadonlySet<string>;
  current: ReadonlySet<string>;
}

const CARD_HIDDEN = { opacity: 0, y: 8 };
const CARD_VISIBLE = { opacity: 1, y: 0 };
const CARD_TRANSITION = { duration: 0.28, ease: [0.2, 0, 0, 1] as const };
const CARD_STAGGER = 0.035;
const CARD_STAGGER_CAP = 12;
const NO_NEW_CARDS: ReadonlyMap<string, number> = new Map();

const resolveCardTransition = (order: number) => ({
  ...CARD_TRANSITION,
  delay: Math.min(order, CARD_STAGGER_CAP) * CARD_STAGGER,
});

const resolveNewOrders = (events: CalendarEvent[], seen: ReadonlySet<string>): ReadonlyMap<string, number> => {
  const orders = new Map<string, number>();
  for (const event of events) {
    if (!seen.has(event.id)) orders.set(event.id, orders.size);
  }
  return orders;
};

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
    <div className="flex flex-col gap-3 lg:h-full">
      <EventsHeader />
      <PageBody>
        <EventsContent />
      </PageBody>
    </div>
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
  // Cards already on screen when the page mounts (cached data) stay put; ids seen for the first time rise in.
  const [seen, setSeen] = useState<SeenIds>(() => {
    const initial = new Set(isLoading ? [] : events.map((event) => event.id));
    return { previous: initial, current: initial };
  });
  const unseen = events.filter((event) => !seen.current.has(event.id));
  if (unseen.length > 0) {
    setSeen({ previous: seen.current, current: new Set([...seen.current, ...unseen.map((event) => event.id)]) });
  }
  const newOrders = reduceMotion ? NO_NEW_CARDS : resolveNewOrders(events, seen.previous);
  const dayGroups = groupEventsByDay(events);

  if (isLoading) return <LoadingIndicator />;
  if (error) return <ErrorState message="Failed to load events." />;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-4">
        <LazyMotion features={loadMotionFeatures}>
          {dayGroups.map((group) => (
            <DaySection key={group.label} label={group.label} events={group.events} newOrders={newOrders} />
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

const DaySection = memo(function DaySection({ label, events, newOrders }: DaySectionProps) {
  return (
    <div className="flex flex-col px-0.5">
      <DashboardHeading2>{label}</DashboardHeading2>
      <div className="flex flex-col gap-2 pt-1">
        {events.map((event) => {
          const order = newOrders.get(event.id);
          return (
            <m.div
              key={event.id}
              initial={order === undefined ? false : CARD_HIDDEN}
              animate={CARD_VISIBLE}
              transition={order === undefined ? undefined : resolveCardTransition(order)}
            >
              <EventCard event={event} past={isEventPast(event.endTime)} />
            </m.div>
          );
        })}
      </div>
    </div>
  );
});
