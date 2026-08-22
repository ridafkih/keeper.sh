import { useCallback, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/utils/cn";
import { useStartOfToday } from "@/hooks/use-start-of-today";
import { isEventPast } from "@/lib/time";
import type { CalendarEvent } from "@/hooks/use-events";
import { Text } from "@/components/ui/primitives/text";
import { CalendarFrame } from "./calendar-frame";
import { isSameDay, isSameMonth, WEEKDAY_LABELS } from "./calendar-helpers";
import { EventPill, EventPillOverflow } from "./event-card";
import { EVENT_PILL_GAP_PX, resolvePillRows, resolveVisiblePillCount } from "./event-layout";
import type { DayEvents } from "./event-layout";

const COLUMNS = 7;
const ROWS = 6;

const EDGE_FADE_SIZE = 24;

// Cell rules on their own layer behind the cells, so they can fade at the edges without touching the day numbers.
const CELL_RULES: CSSProperties = {
  backgroundImage: [
    "linear-gradient(to right, transparent calc(100% - 1px), var(--color-border-elevated) calc(100% - 1px))",
    "linear-gradient(to bottom, transparent calc(100% - 1px), var(--color-border-elevated) calc(100% - 1px))",
  ].join(", "),
  backgroundSize: `calc(100% / ${COLUMNS}) 100%, 100% calc(100% / ${ROWS})`,
  backgroundRepeat: "repeat-x, repeat-y",
};

const EDGE_FADE = [
  `linear-gradient(to bottom, transparent, black ${EDGE_FADE_SIZE}px, black calc(100% - ${EDGE_FADE_SIZE}px), transparent)`,
  `linear-gradient(to right, transparent, black ${EDGE_FADE_SIZE}px, black calc(100% - ${EDGE_FADE_SIZE}px), transparent)`,
].join(", ");
const RULE_LAYER_STYLE: CSSProperties = {
  ...CELL_RULES,
  maskImage: EDGE_FADE,
  WebkitMaskImage: EDGE_FADE,
  maskComposite: "intersect",
  WebkitMaskComposite: "source-in",
};

interface MonthGridProps {
  anchor: Date;
  days: Date[];
  /** Keyed by local-midnight `getTime()` (see `bucketEventsByDay`); days outside the window are absent. */
  eventsByDay: Map<number, DayEvents>;
  toolbar: ReactNode;
}

const NO_EVENTS: CalendarEvent[] = [];

export function MonthGrid({ anchor, days, eventsByDay, toolbar }: MonthGridProps) {
  const today = useStartOfToday();
  const [pillRows, setPillRows] = useState(0);

  // Measures the row budget from the first cell's pill area (every cell is
  // the same height, so one measurement serves all), and keeps measuring
  // through resizes. A callback ref rather than a mount effect: the cells are
  // keyed by day, so paging the month mounts a new first cell, and an
  // observer attached once on mount would be left watching the old, detached
  // node — which reports a zero height, folding every cell to "+N more". The
  // ref runs again for each new node, and its cleanup disconnects the old
  // observer. The observer reports once on `observe`, which is the first read.
  const observePillArea = useCallback((pillArea: HTMLDivElement | null) => {
    if (!pillArea || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setPillRows(resolvePillRows(entry.contentRect.height));
    });
    observer.observe(pillArea);
    return () => observer.disconnect();
  }, []);

  return (
    <CalendarFrame
      toolbar={toolbar}
      columnHeader={
        <div className="grid grid-cols-7">
          {WEEKDAY_LABELS.map((label) => (
            <Text
              key={label}
              as="span"
              size="xs"
              tone="muted"
              className="px-2 py-2 font-medium uppercase tracking-wide"
            >
              {label}
            </Text>
          ))}
        </div>
      }
    >
      <div className="relative min-h-0 flex-1">
        <div aria-hidden className="pointer-events-none absolute inset-0" style={RULE_LAYER_STYLE} />
        <div className="relative grid h-full grid-cols-7 grid-rows-6">
          {days.map((day, index) => {
            const inMonth = isSameMonth(day, anchor);
            const isToday = isSameDay(day, today);
            const dayEvents = eventsByDay.get(day.getTime());
            // All-day first, then the timed events as they fall (the buckets
            // keep each list in start order).
            const pills = dayEvents ? [...dayEvents.allDay, ...dayEvents.timed] : NO_EVENTS;
            const { visibleCount, hiddenCount } = resolveVisiblePillCount(pills.length, pillRows);
            return (
              <div
                key={day.getTime()}
                className="flex min-h-0 flex-col gap-0.5 overflow-hidden p-1.5"
              >
                <span
                  className={cn(
                    "flex size-6 items-center justify-center self-start text-xs font-medium tabular-nums",
                    isToday && "rounded-full bg-emerald-400 text-neutral-950",
                    !isToday && inMonth && "text-foreground",
                    !isToday && !inMonth && "text-foreground-disabled",
                  )}
                >
                  {day.getDate()}
                </span>
                <div
                  ref={index === 0 ? observePillArea : undefined}
                  className="flex min-h-0 flex-1 flex-col overflow-hidden"
                  style={{ gap: EVENT_PILL_GAP_PX }}
                >
                  {pills.slice(0, visibleCount).map((event) => (
                    <EventPill key={event.id} event={event} past={isEventPast(event.endTime)} />
                  ))}
                  {hiddenCount > 0 && <EventPillOverflow count={hiddenCount} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </CalendarFrame>
  );
}
