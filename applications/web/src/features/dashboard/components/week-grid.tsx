import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { cn } from "@/utils/cn";
import { useStartOfToday } from "@/hooks/use-start-of-today";
import { isEventPast } from "@/lib/time";
import type { CalendarEvent } from "@/hooks/use-events";
import { Text } from "@/components/ui/primitives/text";
import { CalendarFrame } from "./calendar-frame";
import { DayColumn } from "./day-column";
import { EventPill, EventPillOverflow } from "./event-card";
import {
  EVENT_PILL_GAP_PX,
  EVENT_PILL_HEIGHT_PX,
  resolveVisiblePillCount,
  timeOfDayFraction,
} from "./event-layout";
import type { DayEvents } from "./event-layout";
import {
  addDays,
  formatHourLabel,
  HOUR_HEIGHT,
  HOURS,
  isSameDay,
  startOfDay,
  startOfVisibleWeek,
  WEEK_VIEW_DAYS,
} from "./calendar-helpers";

const GUTTER_WIDTH = 52;
const HEADER_HEIGHT = 56;
const ALL_DAY_MAX_ROWS = 2;
const ALL_DAY_BAND_PADDING_BOTTOM = 4;
const VISIBLE_COLUMNS = WEEK_VIEW_DAYS;
const CENTER_OFFSET = Math.floor(VISIBLE_COLUMNS / 2);
/** Weeks buffered on each side of the entry range, so the strip scrolls without recentering logic. */
const BUFFER_WEEKS = 26;

const MS_PER_DAY = 86_400_000;

// One stable identity, so the memoised columns don't see a fresh [] each render.
const NO_EVENTS: CalendarEvent[] = [];

/** Whether the header's day row can follow the grid's scroll through a CSS
 * scroll timeline (see `.calendar-strip-row` in index.css). The same feature
 * the stylesheet gates on, so the JS mirror below only runs where the CSS
 * does not — both moving the row would scroll it twice. Resolved once: it
 * only varies by engine, and on the server it is false without effect. */
const HEADER_FOLLOWS_SCROLL_TIMELINE =
  typeof CSS !== "undefined" && CSS.supports("animation-timeline", "scroll()");

const HEADER_RULE_FADE = "linear-gradient(to top, black 35%, transparent)";

const GRID_EDGE_FADE_SIZE = 24;

// Vertical only: a horizontal fade would dim the gutter labels and the outermost column.
const GRID_EDGE_FADE = `linear-gradient(to bottom, transparent, black ${GRID_EDGE_FADE_SIZE}px, black calc(100% - ${GRID_EDGE_FADE_SIZE}px), transparent)`;

interface DayHeaderCellProps {
  day: Date;
  isToday: boolean;
  /** The day's all-day events, identity-stable while unchanged. */
  allDay: CalendarEvent[];
  /** Rows the band currently shows; a day with more folds the rest away. */
  bandRows: number;
}

/** One day of the header row: the weekday and date over the day's all-day
 * pills. Memoised so a scroll-driven anchor change only re-renders the cells
 * whose events or band actually changed. */
const DayHeaderCell = memo(function DayHeaderCell({
  day,
  isToday,
  allDay,
  bandRows,
}: DayHeaderCellProps) {
  const { visibleCount, hiddenCount } = resolveVisiblePillCount(allDay.length, bandRows);

  return (
    <div className="relative flex flex-col overflow-hidden">
      {/* The column's left rule, faded toward the top so it dissolves into the
          toolbar above instead of meeting it at a hard corner. On the cell,
          so it moves with the row. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-px bg-border-elevated"
        style={{ maskImage: HEADER_RULE_FADE, WebkitMaskImage: HEADER_RULE_FADE }}
      />
      <div
        className="flex shrink-0 flex-col items-center justify-center gap-1"
        style={{ height: HEADER_HEIGHT }}
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
      {allDay.length > 0 && (
        <div className="flex flex-col px-0.5" style={{ gap: EVENT_PILL_GAP_PX }}>
          {allDay.slice(0, visibleCount).map((event) => (
            <EventPill key={event.id} event={event} past={isEventPast(event.endTime)} />
          ))}
          {hiddenCount > 0 && <EventPillOverflow count={hiddenCount} />}
        </div>
      )}
    </div>
  );
});

interface WeekGridProps {
  anchor: Date;
  /** Keyed by local-midnight `getTime()` (see `bucketEventsByDay`); days outside the window are absent. */
  eventsByDay: Map<number, DayEvents>;
  onCenterDayChange: (centerDay: Date) => void;
  toolbar: ReactNode;
}

export function WeekGrid({ anchor, eventsByDay, onCenterDayChange, toolbar }: WeekGridProps) {
  const today = useStartOfToday();
  const router = useRouter();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const headerStripRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  /** Vertical offset as last scrolled; put back after the router replays a cached one. */
  const scrollTopRef = useRef(0);
  /** Centre day (ms) the strip is aligned to; keeps the anchor effect from reacting to the strip's own reports. */
  const alignedCenterMsRef = useRef<number | null>(null);
  /** Width (px) the strip was last aligned at; a scroll report at a different width is a resize, not paging. */
  const alignedWidthRef = useRef<number | null>(null);

  const [stripDays] = useState(() => {
    const start = addDays(startOfVisibleWeek(anchor), -BUFFER_WEEKS * 7);
    return Array.from({ length: (BUFFER_WEEKS * 2 + 1) * 7 }, (_, index) =>
      addDays(start, index),
    );
  });
  const columnsTemplate = `repeat(${stripDays.length}, minmax(0, 1fr))`;

  // Client-only so SSR and hydration agree; wall-clock placed so the line holds its hour through DST days.
  const [nowFraction, setNowFraction] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNowFraction(timeOfDayFraction(new Date()));
    update();
    const interval = globalThis.setInterval(update, 60_000);
    return () => globalThis.clearInterval(interval);
  }, []);

  const columnWidth = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return 1;
    return Math.max((el.clientWidth - GUTTER_WIDTH) / VISIBLE_COLUMNS, 1);
  }, []);

  /** Fallback for engines without scroll timelines: mirrors the scroller's
   * horizontal offset onto the header strip from the scroll event, a frame
   * behind the grid. A no-op where the row follows the timeline in CSS. */
  const syncHeaderStrip = useCallback(() => {
    if (HEADER_FOLLOWS_SCROLL_TIMELINE) return;
    const scroller = scrollerRef.current;
    const headerStrip = headerStripRef.current;
    if (!scroller || !headerStrip) return;
    headerStrip.scrollLeft = scroller.scrollLeft;
  }, []);

  const scrollToCenter = useCallback(
    (centerDay: Date, behavior: ScrollBehavior) => {
      const el = scrollerRef.current;
      if (!el) return;
      const first = startOfVisibleWeek(centerDay);
      const index = Math.round((first.getTime() - stripDays[0].getTime()) / MS_PER_DAY);
      const clamped = Math.max(0, Math.min(index, stripDays.length - VISIBLE_COLUMNS));
      alignedCenterMsRef.current = centerDay.getTime();
      alignedWidthRef.current = el.clientWidth;
      el.scrollTo({ left: clamped * columnWidth(), behavior });
      // An instant jump fires no scroll event; mirror right away so the header never shows a stale range.
      if (behavior === "auto") syncHeaderStrip();
    },
    [columnWidth, stripDays, syncHeaderStrip],
  );

  // Mount: centre the anchor and jump to business hours; afterwards, smooth-scroll on anchor moves.
  useLayoutEffect(() => {
    const centerDay = startOfDay(anchor);
    if (!mountedRef.current) {
      mountedRef.current = true;
      scrollToCenter(centerDay, "auto");
      const el = scrollerRef.current;
      if (el) {
        el.scrollTop = Math.max(0, (new Date().getHours() - 1) * HOUR_HEIGHT);
        scrollTopRef.current = el.scrollTop;
      }
      return;
    }
    if (centerDay.getTime() !== alignedCenterMsRef.current) {
      scrollToCenter(centerDay, "smooth");
    }
  }, [anchor, scrollToCenter]);

  // The router replays cached scroll offsets after navigation; this registers after it and puts the strip back.
  useEffect(
    () =>
      router.subscribe("onRendered", () => {
        const el = scrollerRef.current;
        const alignedCenterMs = alignedCenterMsRef.current;
        if (!el || alignedCenterMs === null) return;
        el.scrollTop = scrollTopRef.current;
        scrollToCenter(new Date(alignedCenterMs), "auto");
      }),
    [router, scrollToCenter],
  );

  // Column widths follow the scroller's width, so a resize would drift the strip; re-snap to the centred day.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const width = el.clientWidth;
      if (width === 0 || width === alignedWidthRef.current) return;
      const alignedCenterMs = alignedCenterMsRef.current;
      if (alignedCenterMs === null) {
        alignedWidthRef.current = width;
        return;
      }
      scrollToCenter(new Date(alignedCenterMs), "auto");
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollToCenter]);

  const handleScroll = () => {
    // Mirror synchronously, not in the rAF, so the header never trails the grid by a frame.
    syncHeaderStrip();
    const scroller = scrollerRef.current;
    if (scroller) scrollTopRef.current = scroller.scrollTop;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = scrollerRef.current;
      if (!el) return;
      // Mid-resize offsets belong to the old width; the resize observer re-aligns the strip.
      if (el.clientWidth !== alignedWidthRef.current) return;
      const index = Math.max(
        0,
        Math.min(Math.round(el.scrollLeft / columnWidth()), stripDays.length - VISIBLE_COLUMNS),
      );
      const centerDay = stripDays[index + CENTER_OFFSET];
      if (centerDay.getTime() === alignedCenterMsRef.current) return;
      alignedCenterMsRef.current = centerDay.getTime();
      onCenterDayChange(centerDay);
    });
  };

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // The band's rows follow the visible days, so the header only grows when
  // a day with all-day events is on screen; the height eases between sizes.
  const visibleStart = startOfVisibleWeek(anchor);
  let mostAllDay = 0;
  for (let index = 0; index < VISIBLE_COLUMNS; index++) {
    const allDayCount = eventsByDay.get(addDays(visibleStart, index).getTime())?.allDay.length ?? 0;
    mostAllDay = Math.max(mostAllDay, allDayCount);
  }
  const bandRows = Math.min(mostAllDay, ALL_DAY_MAX_ROWS);
  const bandHeight =
    bandRows === 0
      ? 0
      : bandRows * EVENT_PILL_HEIGHT_PX +
        (bandRows - 1) * EVENT_PILL_GAP_PX +
        ALL_DAY_BAND_PADDING_BOTTOM;

  const dayRow = (
    <div
      className="flex transition-[height] duration-200 motion-reduce:transition-none"
      style={{ height: HEADER_HEIGHT + bandHeight }}
    >
      <div className="shrink-0" style={{ width: GUTTER_WIDTH }} />
      <div ref={headerStripRef} className="relative min-w-0 flex-1 overflow-hidden">
        <div
          className="calendar-strip-row relative grid h-full"
          style={
            {
              gridTemplateColumns: columnsTemplate,
              width: `calc(${stripDays.length} * 100% / ${VISIBLE_COLUMNS})`,
              // How far the row travels at full scroll — its own width less
              // the viewport's, as a share of its width — for the scroll
              // timeline in index.css. The same ratio as the grid's scroll
              // range, so the two coincide to the pixel at every offset.
              "--calendar-strip-travel": `calc(-100% * ${stripDays.length - VISIBLE_COLUMNS} / ${stripDays.length})`,
            } as CSSProperties
          }
        >
          {stripDays.map((day) => (
            <DayHeaderCell
              key={day.getTime()}
              day={day}
              isToday={isSameDay(day, today)}
              allDay={eventsByDay.get(day.getTime())?.allDay ?? NO_EVENTS}
              bandRows={bandRows}
            />
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <CalendarFrame
      toolbar={toolbar}
      columnHeader={dayRow}
      gridMaxHeight={HOUR_HEIGHT * HOURS.length}
    >
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="calendar-strip-scroller flex min-h-0 flex-1 items-start snap-x snap-mandatory overflow-auto overscroll-x-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{
          scrollPaddingLeft: GUTTER_WIDTH,
          maskImage: GRID_EDGE_FADE,
          WebkitMaskImage: GRID_EDGE_FADE,
        }}
      >
        <div
          className="sticky left-0 z-30 shrink-0 bg-background"
          style={{ width: GUTTER_WIDTH, height: HOUR_HEIGHT * HOURS.length }}
        >
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
        <div
          className="relative grid shrink-0"
          style={{
            gridTemplateColumns: columnsTemplate,
            width: `calc(${stripDays.length} * (100% - ${GUTTER_WIDTH}px) / ${VISIBLE_COLUMNS})`,
            height: HOUR_HEIGHT * HOURS.length,
          }}
        >
          {stripDays.map((day) => {
            const isToday = isSameDay(day, today);
            return (
              <DayColumn
                key={day.getTime()}
                day={day}
                isToday={isToday}
                nowFraction={isToday ? nowFraction : null}
                events={eventsByDay.get(day.getTime())?.timed ?? NO_EVENTS}
              />
            );
          })}
        </div>
      </div>
    </CalendarFrame>
  );
}
