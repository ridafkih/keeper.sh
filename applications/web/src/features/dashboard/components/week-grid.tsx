import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { scroll } from "motion";
import { animate } from "motion/mini";
import { cn } from "@/utils/cn";
import { resolveDataAttr } from "@/utils/data-attr";
import { eventDetailAtom } from "@/state/event-detail";
import {
  EVENT_GRAPH_DAYS_BEFORE,
  calendarHighlightSlotAtom,
  eventGraphHoverIndexAtom,
  resolveGraphSlotIndex,
} from "@/state/event-graph-hover";
import { useCalendarHighlightedDay } from "@/hooks/use-calendar-highlighted-day";
import { useSetPopoverOverlay } from "@/hooks/use-popover-overlay";
import { useNowMinute } from "@/hooks/use-now-minute";
import { useStartOfToday } from "@/hooks/use-start-of-today";
import { isEventPast } from "@/lib/time";
import type { CalendarEvent } from "@/hooks/use-events";
import { Text } from "@/components/ui/primitives/text";
import { CalendarFrame } from "./calendar-frame";
import { DayColumn } from "./day-column";
import { EventPill, EventPillOverflow } from "./event-card";
import { EventDetailPopover } from "./event-detail-popover";
import { NowIndicator, NowPill } from "./now-indicator";
import { resolveNowLayout } from "./now-layout";
import {
  EVENT_PILL_GAP_PX,
  EVENT_PILL_HEIGHT_PX,
  resolveDensityPips,
  resolveVisiblePillCount,
} from "./event-layout";
import type { DayEvents } from "./event-layout";
import { periodFill, periodWash, resolvePeriod } from "./density-period";
import type { Period } from "./density-period";
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
const HEADER_HEIGHT = 64;
const ALL_DAY_MAX_ROWS = 2;
const ALL_DAY_BAND_PADDING_BOTTOM = 4;
const VISIBLE_COLUMNS = WEEK_VIEW_DAYS;
const CENTER_OFFSET = Math.floor(VISIBLE_COLUMNS / 2);
/** Weeks buffered on each side of the entry range, so the strip scrolls without recentering logic. */
const BUFFER_WEEKS = 26;

const MS_PER_DAY = 86_400_000;

// One stable identity, so the memoised columns don't see a fresh [] each render.
const NO_EVENTS: CalendarEvent[] = [];

interface DayDensityPipsProps {
  count: number;
  period: Period;
}

function DayDensityPips({ count, period }: DayDensityPipsProps) {
  const { pips, overflow } = resolveDensityPips(count);

  return (
    <div className="flex h-1 justify-center gap-0.5">
      {Array.from({ length: pips }, (_, index) => (
        <span
          key={index}
          className={periodFill({
            period,
            className: cn("h-1 rounded-full", overflow && index === pips - 1 ? "w-4" : "w-[7px]"),
          })}
        />
      ))}
    </div>
  );
}

interface DayHeaderCellProps {
  day: Date;
  dayOffset: number;
  timedCount: number;
  allDay: CalendarEvent[];
  bandRows: number;
  bandHeight: number;
}

const DayHeaderCell = memo(function DayHeaderCell({
  day,
  dayOffset,
  timedCount,
  allDay,
  bandRows,
  bandHeight,
}: DayHeaderCellProps) {
  const { visibleCount, hiddenCount } = resolveVisiblePillCount(allDay.length, bandRows);
  const period = resolvePeriod(dayOffset);
  const setGraphHoverIndex = useSetAtom(eventGraphHoverIndexAtom);
  const active = useCalendarHighlightedDay(dayOffset);

  return (
    <div
      className="relative flex flex-col overflow-x-clip"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setGraphHoverIndex(resolveGraphSlotIndex(dayOffset));
      }}
      onPointerLeave={() => setGraphHoverIndex(null)}
    >
      {/* Ramps upward as the header fill evaporates downward, and runs on under the grid so a vertical overscroll bounce can't part it from the column rule. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 -bottom-40 left-0 w-px bg-border-elevated mask-t-from-[calc(100%-2.625rem)]"
      />
      <div
        className={periodWash({
          period,
          className:
            "flex flex-col group-data-highlighting:opacity-45 data-active:opacity-100",
        })}
        data-active={resolveDataAttr(active)}
      >
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
              period === "today" ? "rounded-full bg-emerald-400 text-neutral-950" : "text-foreground",
            )}
          >
            {day.getDate()}
          </span>
          <DayDensityPips count={timedCount} period={period} />
        </div>
        <div
          className="flex flex-col overflow-clip px-0.5 transition-[height] duration-200 motion-reduce:transition-none"
          style={{ height: bandHeight, gap: EVENT_PILL_GAP_PX }}
        >
          {allDay.slice(0, visibleCount).map((event) => (
            <EventPill key={event.id} event={event} past={isEventPast(event.endTime)} />
          ))}
          {hiddenCount > 0 && <EventPillOverflow count={hiddenCount} />}
        </div>
      </div>
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
  const rowRef = useRef<HTMLDivElement>(null);
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

  const now = useNowMinute();
  const nowLayout = now && resolveNowLayout(stripDays, now);
  const resolveDayOffset = (day: Date) =>
    Math.round((day.getTime() - today.getTime()) / MS_PER_DAY);
  const highlightSlot = useAtomValue(calendarHighlightSlotAtom);
  const highlightVisible =
    highlightSlot !== null &&
    Math.abs(highlightSlot - EVENT_GRAPH_DAYS_BEFORE - resolveDayOffset(startOfDay(anchor))) <=
      CENTER_OFFSET;

  const columnWidth = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return 1;
    return Math.max((el.clientWidth - GUTTER_WIDTH) / VISIBLE_COLUMNS, 1);
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
    },
    [columnWidth, stripDays],
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

  // The day row follows the grid via Motion's ScrollTimeline — a scrollLeft mirror trails compositor scrolling by a frame.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const row = rowRef.current;
    if (!scroller || !row) return;
    const travel = (-100 * (stripDays.length - VISIBLE_COLUMNS)) / stripDays.length;
    const animation = animate(
      row,
      { transform: ["translateX(0%)", `translateX(${travel}%)`] },
      { ease: "linear" },
    );
    const cancel = scroll(animation, { container: scroller, axis: "x" });
    return () => {
      cancel();
      animation.cancel();
    };
  }, [stripDays]);

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

  // Write-only: subscribing would reconcile all 742 memoised day cells on every open/close.
  const setDetail = useSetAtom(eventDetailAtom);
  const setOverlay = useSetPopoverOverlay();

  const closeDetail = useCallback(() => {
    setDetail(null);
    setOverlay(false);
  }, [setDetail, setOverlay]);

  useEffect(
    () => () => {
      setDetail(null);
      setOverlay(false);
    },
    [setDetail, setOverlay],
  );

  // A refetch replaces event objects; swap the fresh one into an open panel.
  useEffect(() => {
    setDetail((prev) => {
      if (!prev) return prev;
      for (const day of eventsByDay.values()) {
        const fresh = day.timed.find((candidate) => candidate.id === prev.event.id);
        if (fresh) return fresh === prev.event ? prev : { ...prev, event: fresh };
      }
      return prev;
    });
  }, [eventsByDay, setDetail]);

  const handleEventClick = (clickEvent: ReactMouseEvent) => {
    const target = (clickEvent.target as Element).closest<HTMLElement>("[data-event-id]");
    const scroller = scrollerRef.current;
    if (!target || !scroller) return;
    const id = target.dataset.eventId;
    let event: CalendarEvent | undefined;
    for (const day of eventsByDay.values()) {
      event = day.timed.find((candidate) => candidate.id === id);
      if (event) break;
    }
    if (!event) return;
    const rect = target.getBoundingClientRect();
    const frameRect = scroller.getBoundingClientRect();
    setDetail({
      event,
      trigger: target,
      anchor: rect,
      frame: {
        top: frameRect.top,
        left: frameRect.left + GUTTER_WIDTH,
        right: frameRect.right,
        bottom: frameRect.bottom,
      },
    });
    setOverlay(true);
  };

  const handleScroll = () => {
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
    <div className="flex">
      <div className="shrink-0" style={{ width: GUTTER_WIDTH }} />
      <div className="relative min-w-0 flex-1 overflow-x-clip">
        <div
          ref={rowRef}
          className="group relative grid"
          data-highlighting={resolveDataAttr(highlightVisible)}
          style={{
            gridTemplateColumns: columnsTemplate,
            width: `calc(${stripDays.length} * 100% / ${VISIBLE_COLUMNS})`,
          }}
        >
          {stripDays.map((day) => (
            <DayHeaderCell
              key={day.getTime()}
              day={day}
              dayOffset={resolveDayOffset(day)}
              timedCount={eventsByDay.get(day.getTime())?.timed.length ?? 0}
              allDay={eventsByDay.get(day.getTime())?.allDay ?? NO_EVENTS}
              bandRows={bandRows}
              bandHeight={bandHeight}
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
      {/* Bottom only: a horizontal fade would dim the gutter labels and the outermost column, and a top one would wash out the band the header dissolves into. */}
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="flex min-h-0 flex-1 items-start snap-x snap-mandatory overflow-auto overscroll-x-none mask-b-from-[calc(100%-24px)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ scrollPaddingLeft: GUTTER_WIDTH }}
      >
        <div
          className="sticky left-0 z-30 shrink-0 bg-background"
          style={{ width: GUTTER_WIDTH, height: HOUR_HEIGHT * HOURS.length }}
        >
          {HOURS.slice(1).map((hour) => (
            <span
              key={hour}
              className={cn(
                "absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-foreground-muted",
                hour === nowLayout?.coveredHour && "invisible",
              )}
              style={{ top: hour * HOUR_HEIGHT }}
            >
              {formatHourLabel(hour)}
            </span>
          ))}
          {nowLayout && <NowPill layout={nowLayout} />}
        </div>
        <div
          onClick={handleEventClick}
          className="relative grid shrink-0"
          style={{
            gridTemplateColumns: columnsTemplate,
            width: `calc(${stripDays.length} * (100% - ${GUTTER_WIDTH}px) / ${VISIBLE_COLUMNS})`,
            height: HOUR_HEIGHT * HOURS.length,
          }}
        >
          {stripDays.map((day) => (
            <DayColumn
              key={day.getTime()}
              day={day}
              dayOffset={resolveDayOffset(day)}
              now={isSameDay(day, today) ? now : null}
              events={eventsByDay.get(day.getTime())?.timed ?? NO_EVENTS}
            />
          ))}
          {nowLayout && <NowIndicator layout={nowLayout} />}
        </div>
      </div>
      <EventDetailPopover onClose={closeDetail} />
    </CalendarFrame>
  );
}
