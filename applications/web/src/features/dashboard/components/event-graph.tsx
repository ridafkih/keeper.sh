import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { atom } from "jotai";
import { useAtomValue, useSetAtom } from "jotai";
import * as m from "motion/react-m";
import { LazyMotion } from "motion/react";
import { loadMotionFeatures } from "@/lib/motion-features";
import {
  EVENT_GRAPH_DAYS_AFTER,
  EVENT_GRAPH_DAYS_BEFORE,
  EVENT_GRAPH_TOTAL_DAYS,
  eventGraphHoverIndexAtom,
} from "@/state/event-graph-hover";
import { fetcher } from "@/lib/fetcher";
import { useAnimatedSWR } from "@/hooks/use-animated-swr";
import { pluralize } from "@/lib/pluralize";
import { Text } from "@/components/ui/primitives/text";
import { useStartOfToday } from "@/hooks/use-start-of-today";
import type { ApiEventSummary } from "@/types/api";
import { periodFill, resolvePeriod } from "./density-period";
import type { Period } from "./density-period";

const GRAPH_HEIGHT = 96;
const MIN_BAR_HEIGHT = 20;

const MS_PER_DAY = 86_400_000;

const buildGraphUrl = (todayStart: Date): string => {
  const from = new Date(todayStart.getTime() - EVENT_GRAPH_DAYS_BEFORE * MS_PER_DAY);
  const to = new Date(
    todayStart.getTime() + EVENT_GRAPH_DAYS_AFTER * MS_PER_DAY + MS_PER_DAY - 1,
  );
  return `/api/events?from=${from.toISOString()}&to=${to.toISOString()}`;
};

const countEventsByDay = (events: ApiEventSummary[], todayTimestamp: number): number[] => {
  const counts = new Array<number>(EVENT_GRAPH_TOTAL_DAYS).fill(0);
  for (const event of events) {
    const eventDate = new Date(event.startTime);
    const dayOffset = Math.floor((eventDate.getTime() - todayTimestamp) / MS_PER_DAY);
    const slotIndex = dayOffset + EVENT_GRAPH_DAYS_BEFORE;
    if (slotIndex >= 0 && slotIndex < EVENT_GRAPH_TOTAL_DAYS) counts[slotIndex]++;
  }
  return counts;
};

interface DayData {
  count: number;
  dayOffset: number;
  height: number;
  fullLabel: string;
  period: Period;
}

const formatDayLabel = (todayStart: Date, dayOffset: number): string => {
  const date = new Date(todayStart);
  date.setDate(date.getDate() + dayOffset);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
};

const GROWTH_SPACE = GRAPH_HEIGHT - MIN_BAR_HEIGHT;

function resolveBarHeight(count: number, maxCount: number): number {
  return MIN_BAR_HEIGHT + (count / maxCount) * GROWTH_SPACE;
}

const normalizeDayData = (counts: number[], todayStart: Date): DayData[] => {
  const maxCount = Math.max(...counts, 1);

  return counts.map((count, slotIndex) => {
    const dayOffset = slotIndex - EVENT_GRAPH_DAYS_BEFORE;
    return {
      count,
      dayOffset,
      height: resolveBarHeight(count, maxCount),
      fullLabel: formatDayLabel(todayStart, dayOffset),
      period: resolvePeriod(dayOffset),
    };
  });
};

const buildDays = (events: ApiEventSummary[], todayStart: Date): DayData[] => {
  const counts = countEventsByDay(events, todayStart.getTime());
  return normalizeDayData(counts, todayStart);
};

function resolveWeekTotal(days: DayData[]): number {
  return days.reduce((sum, day) => sum + day.count, 0);
}

function resolveEventCount(hoverIndex: number | null, days: DayData[]): number {
  if (hoverIndex !== null) return days[hoverIndex].count;
  return resolveWeekTotal(days);
}

function resolveLabel(hoverIndex: number | null, days: DayData[]): string {
  if (hoverIndex !== null) return days[hoverIndex].fullLabel;
  return "This Week";
}

function resolveDataAttr(condition: boolean): "" | undefined {
  if (condition) return "";
  return undefined;
}

interface EventGraphSummaryProps {
  days: DayData[];
}

function EventGraphSummary({ days }: EventGraphSummaryProps) {
  return (
    <div className="flex items-center justify-between">
      <EventGraphEventCount days={days} />
      <EventGraphLabel days={days} />
    </div>
  );
}

function EventGraphEventCount({ days }: EventGraphSummaryProps) {
  const hoverIndex = useAtomValue(eventGraphHoverIndexAtom);
  const count = resolveEventCount(hoverIndex, days);

  return (
    <Text size="sm" tone="muted" align="right" className="tabular-nums">
      {pluralize(count, "event")}
    </Text>
  );
}

function EventGraphLabel({ days }: EventGraphSummaryProps) {
  const hoverIndex = useAtomValue(eventGraphHoverIndexAtom);
  const label = resolveLabel(hoverIndex, days);

  return (
    <Text size="sm" tone="muted" align="right" className="tabular-nums">
      {label}
    </Text>
  );
}

const ANIMATED_TRANSITION = { duration: 0.3, ease: [0.4, 0, 0.2, 1] as const };
const INSTANT_TRANSITION = { duration: 0 };

function resolveBarTransition(shouldAnimate: boolean, dayIndex: number) {
  if (!shouldAnimate) return INSTANT_TRANSITION;
  return { ...ANIMATED_TRANSITION, delay: dayIndex * 0.015 };
}

const isHighlightingAtom = atom((get) => get(eventGraphHoverIndexAtom) !== null);

function useIsHighlighted(index: number): boolean {
  const isHighlightedAtom = useMemo(
    () => atom((get) => get(eventGraphHoverIndexAtom) === index),
    [index],
  );
  return useAtomValue(isHighlightedAtom);
}

interface EventGraphBarProps {
  day: DayData;
  dayIndex: number;
  shouldAnimate: boolean;
}

const EventGraphBar = memo(function EventGraphBar({ day, dayIndex, shouldAnimate }: EventGraphBarProps) {
  const isHighlighted = useIsHighlighted(dayIndex);
  const setHoverIndex = useSetAtom(eventGraphHoverIndexAtom);

  return (
    <div
      className="flex-1 flex flex-col gap-2"
      data-active={resolveDataAttr(isHighlighted)}
      onPointerEnter={() => setHoverIndex(dayIndex)}
    >
      <div
        className="flex items-end"
        style={{ height: GRAPH_HEIGHT }}
      >
        <m.div
          className={periodFill({
            period: day.period,
            className: "w-full flex-1 rounded-[0.625rem]",
          })}
          initial={{ height: MIN_BAR_HEIGHT }}
          animate={{ height: day.height }}
          transition={resolveBarTransition(shouldAnimate, dayIndex)}
        />
      </div>
      <Text
        size="xs"
        tone="default"
        align="center"
        className="font-mono leading-none select-none"
      >
        {day.dayOffset}
      </Text>
    </div>
  );
});

interface EventGraphBarsProps {
  days: DayData[];
  shouldAnimate: boolean;
}

function EventGraphBars({ days, shouldAnimate }: EventGraphBarsProps) {
  const isHighlighting = useAtomValue(isHighlightingAtom);
  const setHoverIndex = useSetAtom(eventGraphHoverIndexAtom);
  const containerRef = useRef<HTMLDivElement>(null);

  const resolveIndexFromTouch = useCallback((touch: React.Touch) => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const index = Math.floor((x / rect.width) * EVENT_GRAPH_TOTAL_DAYS);
    if (index < 0 || index >= EVENT_GRAPH_TOTAL_DAYS) return null;
    return index;
  }, []);

  const handleTouchStart = useCallback(({ touches }: React.TouchEvent) => {
    const touch = touches[0];
    if (!touch) return;
    setHoverIndex(resolveIndexFromTouch(touch));
  }, [resolveIndexFromTouch, setHoverIndex]);

  const handleTouchMove = useCallback((event: React.TouchEvent | TouchEvent) => {
    event.preventDefault();
    const touch = event.touches[0];
    if (!touch) return;
    setHoverIndex(resolveIndexFromTouch(touch));
  }, [resolveIndexFromTouch, setHoverIndex]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const listener = (event: TouchEvent) => handleTouchMove(event);
    container.addEventListener("touchmove", listener, { passive: false });
    return () => container.removeEventListener("touchmove", listener);
  }, [handleTouchMove]);

  const handleTouchEnd = () => setHoverIndex(null);

  return (
    <div
      ref={containerRef}
      className="flex gap-0.5 data-highlighting:*:opacity-50 data-highlighting:*:data-active:opacity-100"
      data-highlighting={resolveDataAttr(isHighlighting)}
      onPointerLeave={() => setHoverIndex(null)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {days.map((day, dayIndex) => (
        <EventGraphBar
          key={day.dayOffset}
          day={day}
          dayIndex={dayIndex}
          shouldAnimate={shouldAnimate}
        />
      ))}
    </div>
  );
}

export function EventGraph() {
  const todayStart = useStartOfToday();
  const graphUrl = buildGraphUrl(todayStart);
  const { data: events, shouldAnimate } = useAnimatedSWR<ApiEventSummary[]>(graphUrl, { fetcher });
  const days = buildDays(events ?? [], todayStart);

  return (
    <LazyMotion features={loadMotionFeatures}>
      <div className="flex flex-col gap-6 pb-4">
        <EventGraphSummary days={days} />
        <EventGraphBars days={days} shouldAnimate={shouldAnimate} />
      </div>
    </LazyMotion>
  );
}
