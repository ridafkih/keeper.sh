import { useAtomValue, useSetAtom } from "jotai";
import { motion } from "motion/react";
import { tv } from "tailwind-variants/lite";
import { eventGraphHoverIndexAtom } from "../../state/event-graph-hover";
import { fetcher } from "../../lib/fetcher";
import { useAnimatedSWR } from "../../hooks/use-animated-swr";
import { pluralize } from "../../lib/pluralize";
import { Text } from "../ui/text";

interface ApiEvent {
  id: string;
  startTime: string;
}

const DAYS_BEFORE = 7;
const DAYS_AFTER = 7;
const TOTAL_DAYS = DAYS_BEFORE + 1 + DAYS_AFTER;
const GRAPH_HEIGHT = 96;
const MIN_BAR_HEIGHT = 20;

const graphBar = tv({
  base: "flex-1 rounded-[0.625rem]",
  variants: {
    period: {
      past: "bg-background-hover border border-border-elevated",
      today: "bg-emerald-400 border-transparent",
      future:
        "bg-emerald-400 border-emerald-500 bg-[repeating-linear-gradient(-45deg,transparent_0_4px,var(--color-illustration-stripe)_4px_8px)]",
    },
  },
});

type Period = "past" | "today" | "future";

const resolvePeriod = (dayOffset: number): Period => {
  if (dayOffset < 0) return "past";
  if (dayOffset === 0) return "today";
  return "future";
};

const MS_PER_DAY = 86_400_000;

const startOfToday = (): Date => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};

const buildGraphUrl = (): string => {
  const today = startOfToday();
  const from = new Date(today.getTime() - DAYS_BEFORE * MS_PER_DAY);
  const to = new Date(today.getTime() + DAYS_AFTER * MS_PER_DAY + MS_PER_DAY - 1);
  return `/api/events?from=${from.toISOString()}&to=${to.toISOString()}`;
};

const countEventsByDay = (events: ApiEvent[]): number[] => {
  const counts = new Array<number>(TOTAL_DAYS).fill(0);
  const todayStart = startOfToday().getTime();
  for (const event of events) {
    const eventDate = new Date(event.startTime);
    const dayOffset = Math.floor((eventDate.getTime() - todayStart) / MS_PER_DAY);
    const slotIndex = dayOffset + DAYS_BEFORE;
    if (slotIndex >= 0 && slotIndex < TOTAL_DAYS) counts[slotIndex]++;
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

const formatDayLabel = (dayOffset: number): string => {
  const date = new Date();
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

const normalizeDayData = (counts: number[]): DayData[] => {
  const maxCount = Math.max(...counts, 1);

  return counts.map((count, slotIndex) => {
    const dayOffset = slotIndex - DAYS_BEFORE;
    return {
      count,
      dayOffset,
      height: resolveBarHeight(count, maxCount),
      fullLabel: formatDayLabel(dayOffset),
      period: resolvePeriod(dayOffset),
    };
  });
};

const buildDays = (events: ApiEvent[]): DayData[] => {
  const counts = countEventsByDay(events);
  return normalizeDayData(counts);
};

function resolveActiveDay(hoverIndex: number | null, days: DayData[], today: DayData): DayData {
  if (hoverIndex !== null) return days[hoverIndex];
  return today;
}

function resolveEventCountLabel(count: number): string {
  return pluralize(count, "event");
}

interface EventGraphSummaryProps {
  days: DayData[];
}

function EventGraphSummary({ days }: EventGraphSummaryProps) {
  const hoverIndex = useAtomValue(eventGraphHoverIndexAtom);
  const today = days[DAYS_BEFORE];
  const activeDay = resolveActiveDay(hoverIndex, days, today);
  const eventCountLabel = resolveEventCountLabel(activeDay.count);

  return (
    <div className="flex items-center justify-between">
      <Text size="sm" tone="muted" className="tabular-nums text-right">
        {eventCountLabel}
      </Text>
      <Text size="sm" tone="muted" className="tabular-nums text-right">
        {activeDay.fullLabel}
      </Text>
    </div>
  );
}

const GRAPH_URL = buildGraphUrl();
const ANIMATED_TRANSITION = { duration: 0.3, ease: [0.4, 0, 0.2, 1] as const };
const INSTANT_TRANSITION = { duration: 0 };

function resolveBarTransition(shouldAnimate: boolean, dayIndex: number) {
  if (!shouldAnimate) return INSTANT_TRANSITION;
  return { ...ANIMATED_TRANSITION, delay: dayIndex * 0.015 };
}

export function EventGraph() {
  const { data: events, shouldAnimate } = useAnimatedSWR<ApiEvent[]>(GRAPH_URL, { fetcher });
  const days = buildDays(events ?? []);
  const setHoverIndex = useSetAtom(eventGraphHoverIndexAtom);

  return (
    <div className="flex flex-col gap-6 pb-4">
      <EventGraphSummary days={days} />

      <div
        className="flex gap-0.5 [&:hover>*]:opacity-50 [&>*:hover]:opacity-100"
        onPointerLeave={() => setHoverIndex(null)}
      >
        {days.map((day, dayIndex) => (
          <div
            key={day.dayOffset}
            className="flex-1 flex flex-col gap-2"
            onPointerEnter={() => setHoverIndex(dayIndex)}
          >
            <div
              className="flex items-end"
              style={{ height: GRAPH_HEIGHT }}
            >
              <motion.div
                className={graphBar({
                  period: day.period,
                  className: "w-full",
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
        ))}
      </div>
    </div>
  );
}
