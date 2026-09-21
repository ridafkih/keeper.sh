import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, Ref } from "react";
import { useRouter } from "@tanstack/react-router";
import { cn } from "@/utils/cn";
import { useStartOfToday } from "@/hooks/use-start-of-today";
import { isEventPast } from "@/lib/time";
import type { CalendarEvent } from "@/hooks/use-events";
import { Text } from "@/components/ui/primitives/text";
import { CalendarFrame } from "./calendar-frame";
import {
  addDays,
  getMonthViewFocusDay,
  isSameDay,
  isSameMonth,
  MONTH_VIEW_ROWS,
  startOfMonthGrid,
  WEEKDAY_LABELS,
} from "./calendar-helpers";
import { EventPill, EventPillOverflow } from "./event-card";
import { EVENT_PILL_GAP_PX, resolvePillRows, resolveVisiblePillCount } from "./event-layout";
import type { DayEvents } from "./event-layout";

const COLUMNS = 7;
const VISIBLE_ROWS = MONTH_VIEW_ROWS;
/** Weeks buffered on each side of the entry month, so the strip scrolls without recentering logic. */
const BUFFER_WEEKS = 52;

const MS_PER_WEEK = 7 * 86_400_000;

const RULE = "var(--color-border-elevated) calc(100% - 1px)";

// Column rules on their own layer behind the scroller, so they can fade at the edges without touching the day numbers.
const COLUMN_RULES: CSSProperties = {
  backgroundImage: `linear-gradient(to right, transparent calc(100% - 1px), ${RULE})`,
  backgroundSize: `calc(100% / ${COLUMNS}) 100%`,
  backgroundRepeat: "repeat-x",
};

const resolveRowRules = (rows: number): CSSProperties => ({
  backgroundImage: `linear-gradient(to bottom, transparent calc(100% - 1px), ${RULE})`,
  backgroundSize: `100% calc(100% / ${rows})`,
  backgroundRepeat: "repeat-y",
});

// One stable identity, so the memoised cells don't see a fresh [] each render.
const NO_EVENTS: CalendarEvent[] = [];

// Rows a notched wheel asks for, or 0 for a trackpad: trackpads report `wheelDeltaY` as -3 × `deltaY`, a wheel whole 120s (or lines, in Firefox).
const resolveWheelNotches = (event: WheelEvent): number => {
  const { wheelDeltaY = 0 } = event as WheelEvent & { wheelDeltaY?: number };
  const notched = wheelDeltaY !== 0 && wheelDeltaY % 120 === 0 && wheelDeltaY !== event.deltaY * -3;
  if (notched) return -wheelDeltaY / 120;
  return event.deltaMode === 0 ? 0 : Math.sign(event.deltaY);
};

const formatDayLabel = (day: Date): string =>
  day.getDate() === 1
    ? day.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : String(day.getDate());

interface MonthDayCellProps {
  day: Date;
  inMonth: boolean;
  isToday: boolean;
  allDay: CalendarEvent[];
  timed: CalendarEvent[];
  pillRows: number;
  pillAreaRef?: Ref<HTMLDivElement>;
}

const MonthDayCell = memo(function MonthDayCell({
  day,
  inMonth,
  isToday,
  allDay,
  timed,
  pillRows,
  pillAreaRef,
}: MonthDayCellProps) {
  const pills = [...allDay, ...timed];
  const { visibleCount, hiddenCount } = resolveVisiblePillCount(pills.length, pillRows);
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-0.5 overflow-hidden p-1.5">
      <span
        className={cn(
          "flex h-6 min-w-6 items-center justify-center self-start px-1 text-xs font-medium tabular-nums transition-colors",
          isToday && "rounded-full bg-emerald-400 text-neutral-950",
          !isToday && inMonth && "text-foreground",
          !isToday && !inMonth && "text-foreground-disabled",
        )}
      >
        {formatDayLabel(day)}
      </span>
      <div
        ref={pillAreaRef}
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
});

interface MonthGridProps {
  anchor: Date;
  /** Keyed by local-midnight `getTime()` (see `bucketEventsByDay`); days outside the window are absent. */
  eventsByDay: Map<number, DayEvents>;
  onAnchorChange: (anchor: Date) => void;
  toolbar: ReactNode;
}

export function MonthGrid({ anchor, eventsByDay, onAnchorChange, toolbar }: MonthGridProps) {
  const today = useStartOfToday();
  const router = useRouter();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const anchorRef = useRef(anchor);
  /** Top row the strip is aligned to; what a resize or a replayed router offset snaps back to. */
  const alignedIndexRef = useRef<number | null>(null);
  /** Height (px) the strip was last aligned at; a scroll report at a different height is a resize, not paging. */
  const alignedHeightRef = useRef<number | null>(null);
  /** Anchor (ms) the strip last reported; keeps the anchor effect from reacting to the strip's own reports. */
  const reportedAnchorMsRef = useRef<number | null>(null);
  /** Row a toolbar- or notch-driven smooth scroll is heading for; rows passed on the way would flip the title back and forth. */
  const pendingIndexRef = useRef<number | null>(null);
  const [pillRows, setPillRows] = useState(0);

  const [stripWeeks] = useState(() => {
    const start = addDays(startOfMonthGrid(anchor), -BUFFER_WEEKS * 7);
    return Array.from({ length: BUFFER_WEEKS * 2 + VISIBLE_ROWS }, (_, index) =>
      Array.from({ length: COLUMNS }, (_, column) => addDays(start, index * 7 + column)),
    );
  });
  const lastIndex = stripWeeks.length - VISIBLE_ROWS;

  const observePillArea = useCallback((pillArea: HTMLDivElement | null) => {
    if (!pillArea || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setPillRows(resolvePillRows(entry.contentRect.height));
    });
    observer.observe(pillArea);
    return () => observer.disconnect();
  }, []);

  const rowHeight = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return 1;
    return Math.max(el.clientHeight / VISIBLE_ROWS, 1);
  }, []);

  const resolveIndex = useCallback(
    (el: HTMLDivElement) =>
      Math.max(0, Math.min(Math.round(el.scrollTop / rowHeight()), lastIndex)),
    [lastIndex, rowHeight],
  );

  const scrollToIndex = useCallback(
    (index: number, behavior: ScrollBehavior) => {
      const el = scrollerRef.current;
      if (!el) return;
      const clamped = Math.max(0, Math.min(index, lastIndex));
      const moving = behavior === "smooth" && clamped !== resolveIndex(el);
      pendingIndexRef.current = moving ? clamped : null;
      alignedIndexRef.current = clamped;
      alignedHeightRef.current = el.clientHeight;
      el.scrollTo({ top: clamped * rowHeight(), behavior });
    },
    [lastIndex, resolveIndex, rowHeight],
  );

  // Mount: jump to the anchor's month; afterwards, smooth-scroll on anchor moves the strip didn't report itself.
  useLayoutEffect(() => {
    anchorRef.current = anchor;
    const gridStart = startOfMonthGrid(anchor);
    const index = Math.round((gridStart.getTime() - stripWeeks[0][0].getTime()) / MS_PER_WEEK);
    if (!mountedRef.current) {
      mountedRef.current = true;
      scrollToIndex(index, "auto");
      return;
    }
    if (anchor.getTime() !== reportedAnchorMsRef.current) scrollToIndex(index, "smooth");
  }, [anchor, scrollToIndex, stripWeeks]);

  // The router replays cached scroll offsets after navigation; this registers after it and puts the strip back.
  useEffect(
    () =>
      router.subscribe("onRendered", () => {
        if (alignedIndexRef.current !== null) scrollToIndex(alignedIndexRef.current, "auto");
      }),
    [router, scrollToIndex],
  );

  // Row heights follow the scroller's height, so a resize would drift the strip; re-snap to the aligned row.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const height = el.clientHeight;
      if (height === 0 || height === alignedHeightRef.current) return;
      if (alignedIndexRef.current === null) {
        alignedHeightRef.current = height;
        return;
      }
      scrollToIndex(alignedIndexRef.current, "auto");
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollToIndex]);

  const handleScroll = () => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = scrollerRef.current;
      if (!el) return;
      // Mid-resize offsets belong to the old height; the resize observer re-aligns the strip.
      if (el.clientHeight !== alignedHeightRef.current) return;
      const index = resolveIndex(el);
      if (pendingIndexRef.current !== null) {
        if (index !== pendingIndexRef.current) return;
        pendingIndexRef.current = null;
      }
      alignedIndexRef.current = index;
      const focusDay = getMonthViewFocusDay(stripWeeks[index][0]);
      if (isSameMonth(focusDay, anchorRef.current)) return;
      anchorRef.current = focusDay;
      reportedAnchorMsRef.current = focusDay.getTime();
      onAnchorChange(focusDay);
    });
  };

  // The user taking over mid-animation hands reporting back to the scroll position.
  const releasePending = () => {
    pendingIndexRef.current = null;
  };

  // An animation that ends short of its row would otherwise leave the title on a month the strip never reached.
  const handleScrollEnd = () => {
    releasePending();
    handleScroll();
  };

  // A notch shorter than half a row would snap straight back, so a notched wheel pages a row per notch instead.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const handleWheel = (event: WheelEvent) => {
      const notches = event.ctrlKey ? 0 : resolveWheelNotches(event);
      if (notches === 0) {
        pendingIndexRef.current = null;
        return;
      }
      event.preventDefault();
      const from = pendingIndexRef.current ?? resolveIndex(el);
      scrollToIndex(from + notches, "smooth");
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [resolveIndex, scrollToIndex]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

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
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* Vertical fade at the bottom only; a top fade would wash out the band the header dissolves into. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 mask-b-from-[calc(100%-24px)] mask-x-from-[calc(100%-24px)]"
          style={COLUMN_RULES}
        />
        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          onScrollEnd={handleScrollEnd}
          onPointerDown={releasePending}
          onKeyDown={releasePending}
          className="relative min-h-0 flex-1 snap-y snap-mandatory overflow-y-auto overscroll-y-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div
            className="relative grid"
            style={{
              gridTemplateRows: `repeat(${stripWeeks.length}, minmax(0, 1fr))`,
              height: `calc(${stripWeeks.length} * 100% / ${VISIBLE_ROWS})`,
            }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 mask-x-from-[calc(100%-24px)]"
              style={resolveRowRules(stripWeeks.length)}
            />
            {stripWeeks.map((week, weekIndex) => (
              <div key={week[0].getTime()} className="relative grid min-h-0 snap-start grid-cols-7">
                {week.map((day, column) => {
                  const dayEvents = eventsByDay.get(day.getTime());
                  return (
                    <MonthDayCell
                      key={day.getTime()}
                      day={day}
                      inMonth={isSameMonth(day, anchor)}
                      isToday={isSameDay(day, today)}
                      allDay={dayEvents?.allDay ?? NO_EVENTS}
                      timed={dayEvents?.timed ?? NO_EVENTS}
                      pillRows={pillRows}
                      pillAreaRef={weekIndex === 0 && column === 0 ? observePillArea : undefined}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </CalendarFrame>
  );
}
