import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import { useStartOfToday } from "@/hooks/use-start-of-today";
import { Text } from "@/components/ui/primitives/text";
import { addDays, formatHourLabel, HOURS, isSameDay, startOfWeek } from "./calendar-helpers";

/** Width of the left time gutter, in pixels. */
const GUTTER_WIDTH = 52;
/** Height of a single hour row, in pixels. */
const HOUR_HEIGHT = 48;
/** Height of the sticky weekday/date header row, in pixels. */
const HEADER_HEIGHT = 56;
/** Visible day columns (a week). */
const VISIBLE_COLUMNS = 7;
/** Weeks buffered on each side of the entry week, giving the strip a long,
 * effectively-continuous horizontal scroll range without recentering logic. */
const BUFFER_WEEKS = 26;

const MS_PER_DAY = 86_400_000;

interface WeekGridProps {
  /** Any date inside the week to show; drives the horizontal scroll position. */
  anchor: Date;
  /** Reports the week (its Sunday) scrolled into view, so the pane title and
   * paging stay in sync with manual horizontal scrolling. */
  onVisibleWeekChange: (weekStart: Date) => void;
}

/**
 * The week grid skeleton, modelled on qali's time strip: a pinned left time
 * gutter, a sticky day header, and a single two-axis scroller whose buffered
 * day columns snap one day at a time — so the week scrolls horizontally like
 * qali's. Presentational only: no events; a current-time line marks today.
 */
export function WeekGrid({ anchor, onVisibleWeekChange }: WeekGridProps) {
  const today = useStartOfToday();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  /** The week (ms) the strip is currently aligned to; guards the anchor effect
   * from re-scrolling in response to the strip's own scroll reports. */
  const alignedWeekMsRef = useRef<number | null>(null);

  // The buffered strip is centered on the week active when the grid mounts, so
  // the entry week sits mid-range and paging stays inside the buffer.
  const [stripDays] = useState(() => {
    const start = addDays(startOfWeek(anchor), -BUFFER_WEEKS * 7);
    return Array.from({ length: (BUFFER_WEEKS * 2 + 1) * 7 }, (_, index) =>
      addDays(start, index),
    );
  });
  const columnsTemplate = `repeat(${stripDays.length}, minmax(0, 1fr))`;

  // Resolve the current-time line on the client only, so SSR and hydration
  // agree (the server has no stable "now").
  const [nowFraction, setNowFraction] = useState<number | null>(null);
  useEffect(() => {
    const update = () => {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      setNowFraction((now.getTime() - startOfDay.getTime()) / MS_PER_DAY);
    };
    update();
    const interval = globalThis.setInterval(update, 60_000);
    return () => globalThis.clearInterval(interval);
  }, []);

  const columnWidth = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return 1;
    return Math.max((el.clientWidth - GUTTER_WIDTH) / VISIBLE_COLUMNS, 1);
  }, []);

  const scrollToWeek = useCallback(
    (weekStart: Date, behavior: ScrollBehavior) => {
      const el = scrollerRef.current;
      if (!el) return;
      const index = Math.round((weekStart.getTime() - stripDays[0].getTime()) / MS_PER_DAY);
      const clamped = Math.max(0, Math.min(index, stripDays.length - VISIBLE_COLUMNS));
      alignedWeekMsRef.current = weekStart.getTime();
      el.scrollTo({ left: clamped * columnWidth(), behavior });
    },
    [columnWidth, stripDays],
  );

  // On mount, jump to the anchor week and down to business hours (auto, no
  // animation); afterwards, smooth-scroll whenever the anchor moves to a
  // different week than the strip is aligned to (button paging / Today).
  useLayoutEffect(() => {
    const weekStart = startOfWeek(anchor);
    if (!mountedRef.current) {
      mountedRef.current = true;
      scrollToWeek(weekStart, "auto");
      const el = scrollerRef.current;
      if (el) el.scrollTop = Math.max(0, (new Date().getHours() - 1) * HOUR_HEIGHT);
      return;
    }
    if (weekStart.getTime() !== alignedWeekMsRef.current) {
      scrollToWeek(weekStart, "smooth");
    }
  }, [anchor, scrollToWeek]);

  const handleScroll = () => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = scrollerRef.current;
      if (!el) return;
      const index = Math.max(
        0,
        Math.min(Math.round(el.scrollLeft / columnWidth()), stripDays.length - VISIBLE_COLUMNS),
      );
      const weekStart = startOfWeek(stripDays[index]);
      if (weekStart.getTime() === alignedWeekMsRef.current) return;
      alignedWeekMsRef.current = weekStart.getTime();
      onVisibleWeekChange(weekStart);
    });
  };

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  return (
    <div
      ref={scrollerRef}
      onScroll={handleScroll}
      className="flex min-h-0 flex-1 items-start overflow-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ scrollSnapType: "x mandatory", scrollPaddingLeft: GUTTER_WIDTH }}
    >
      {/* Pinned time gutter. */}
      <div
        className="sticky left-0 z-30 flex shrink-0 flex-col bg-background-elevated"
        style={{ width: GUTTER_WIDTH }}
      >
        <div
          className="sticky top-0 z-10 shrink-0 border-b border-border-elevated bg-background-elevated"
          style={{ height: HEADER_HEIGHT }}
        />
        <div className="relative shrink-0" style={{ height: HOUR_HEIGHT * HOURS.length }}>
          {HOURS.slice(1).map((hour) => (
            <span
              key={hour}
              className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-foreground-muted"
              style={{ top: hour * HOUR_HEIGHT }}
            >
              {formatHourLabel(hour)}
            </span>
          ))}
        </div>
      </div>
      {/* Buffered day strip: 7 columns fill the viewport, the rest overflow. */}
      <div
        className="flex shrink-0 flex-col"
        style={{ width: `calc(${stripDays.length} * (100% - ${GUTTER_WIDTH}px) / ${VISIBLE_COLUMNS})` }}
      >
        <div
          className="sticky top-0 z-20 grid shrink-0 border-b border-border-elevated bg-background-elevated"
          style={{ gridTemplateColumns: columnsTemplate, height: HEADER_HEIGHT }}
        >
          {stripDays.map((day) => {
            const isToday = isSameDay(day, today);
            return (
              <div
                key={day.getTime()}
                className="flex flex-col items-center justify-center gap-1 border-l border-border-elevated"
                style={{ scrollSnapAlign: "start" }}
              >
                <Text as="span" size="xs" tone="muted" className="font-medium uppercase tracking-wide">
                  {day.toLocaleDateString("en-US", { weekday: "short" })}
                </Text>
                <span
                  className={cn(
                    "flex size-6 items-center justify-center text-xs font-medium tabular-nums",
                    isToday ? "rounded-full bg-emerald-400 text-neutral-950" : "text-foreground",
                  )}
                >
                  {day.getDate()}
                </span>
              </div>
            );
          })}
        </div>
        <div
          className="relative grid shrink-0"
          style={{ gridTemplateColumns: columnsTemplate, height: HOUR_HEIGHT * HOURS.length }}
        >
          {stripDays.map((day) => {
            const isToday = isSameDay(day, today);
            return (
              <div
                key={day.getTime()}
                className="relative border-l border-border-elevated"
                style={{
                  scrollSnapAlign: "start",
                  backgroundImage:
                    "linear-gradient(to bottom, var(--color-border-elevated) 0 1px, transparent 1px)",
                  backgroundSize: `100% ${HOUR_HEIGHT}px`,
                }}
              >
                {/* Event blocks will render here in a later stage. */}
                {isToday && nowFraction != null && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-10 h-0.5 -translate-y-1/2 bg-red-500"
                    style={{ top: `${nowFraction * 100}%` }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
