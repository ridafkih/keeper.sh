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

// Cell rules on their own layer behind the cells, so they can fade at the edges without touching the day numbers.
const CELL_RULES: CSSProperties = {
  backgroundImage: [
    "linear-gradient(to right, transparent calc(100% - 1px), var(--color-border-elevated) calc(100% - 1px))",
    "linear-gradient(to bottom, transparent calc(100% - 1px), var(--color-border-elevated) calc(100% - 1px))",
  ].join(", "),
  backgroundSize: `calc(100% / ${COLUMNS}) 100%, 100% calc(100% / ${ROWS})`,
  backgroundRepeat: "repeat-x, repeat-y",
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

  // A callback ref, not a mount effect: paging mounts a new first cell, and an observer
  // left on the detached node would report zero height and fold every cell to "+N more".
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
        {/* Vertical fade at the bottom only; a top fade would wash out the band the header dissolves into. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 mask-b-from-[calc(100%-24px)] mask-x-from-[calc(100%-24px)]"
          style={CELL_RULES}
        />
        <div className="relative grid h-full grid-cols-7 grid-rows-6">
          {days.map((day, index) => {
            const inMonth = isSameMonth(day, anchor);
            const isToday = isSameDay(day, today);
            const dayEvents = eventsByDay.get(day.getTime());
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
