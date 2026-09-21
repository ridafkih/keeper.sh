import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode, Ref } from "react";
import { cn } from "@/utils/cn";
import { useStartOfToday } from "@/hooks/use-start-of-today";
import { isEventPast } from "@/lib/time";
import type { CalendarEvent } from "@/hooks/use-events";
import { Text } from "@/components/ui/primitives/text";
import { CalendarFrame } from "./calendar-frame";
import {
  addDays,
  DAYS_PER_WEEK,
  getMonthViewFocusDay,
  isSameDay,
  isSameMonth,
  MONTH_VIEW_ROWS,
  MS_PER_DAY,
  startOfMonthGrid,
  WEEKDAY_LABELS,
  withDayOfMonth,
} from "./calendar-helpers";
import { EventPill, EventPillOverflow } from "./event-card";
import { EVENT_PILL_GAP_PX, resolvePillRows, resolveVisiblePillCount } from "./event-layout";
import type { DayEvents } from "./event-layout";
import { useStripRealign } from "./use-strip-realign";
import { resolveWheelNotches, TRACKPAD_GESTURE_MS } from "./wheel-notches";

const COLUMNS = DAYS_PER_WEEK;
const VISIBLE_ROWS = MONTH_VIEW_ROWS;
/** Weeks buffered on each side of the month the strip was built around. */
const BUFFER_WEEKS = 52;
const LAST_INDEX = BUFFER_WEEKS * 2;

const MS_PER_WEEK = DAYS_PER_WEEK * MS_PER_DAY;

const resolveStripStart = (anchor: Date): Date =>
  addDays(startOfMonthGrid(anchor), -BUFFER_WEEKS * DAYS_PER_WEEK);

const resolveStripIndex = (stripStart: Date, anchor: Date): number =>
  Math.round((startOfMonthGrid(anchor).getTime() - stripStart.getTime()) / MS_PER_WEEK);

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
  const scrollerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  /** Strip the scroll position belongs to; a rebuilt strip is jumped to, not scrolled to. */
  const alignedStripRef = useRef<Date[][] | null>(null);
  /** When a wheel event last looked like a trackpad's; whole 120s right after it are still that gesture. */
  const trackpadAtRef = useRef(Number.NEGATIVE_INFINITY);
  // Only a notched wheel needs a cancellable listener; a passive one keeps trackpad scrolling off the main thread.
  const [notchedWheel, setNotchedWheel] = useState(false);
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

  const [stripStart, setStripStart] = useState(() => resolveStripStart(anchor));
  const anchorIndex = resolveStripIndex(stripStart, anchor);
  // The toolbar pages without limit; a month past the buffer gets a strip of its own.
  if (anchorIndex < 0 || anchorIndex > LAST_INDEX) setStripStart(resolveStripStart(anchor));
  const stripWeeks = useMemo(
    () =>
      Array.from({ length: LAST_INDEX + VISIBLE_ROWS }, (_, index) =>
        Array.from({ length: COLUMNS }, (_, column) =>
          addDays(stripStart, index * DAYS_PER_WEEK + column),
        ),
      ),
    [stripStart],
  );

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
      Math.max(0, Math.min(Math.round(el.scrollTop / rowHeight()), LAST_INDEX)),
    [rowHeight],
  );

  const scrollToIndex = useCallback(
    (index: number, behavior: ScrollBehavior) => {
      const el = scrollerRef.current;
      if (!el) return;
      const clamped = Math.max(0, Math.min(index, LAST_INDEX));
      const moving = behavior === "smooth" && clamped !== resolveIndex(el);
      pendingIndexRef.current = moving ? clamped : null;
      alignedIndexRef.current = clamped;
      alignedHeightRef.current = el.clientHeight;
      el.scrollTo({ top: clamped * rowHeight(), behavior });
    },
    [resolveIndex, rowHeight],
  );

  // A fresh strip is jumped to; afterwards, smooth-scroll on anchor moves the strip didn't report itself.
  useLayoutEffect(() => {
    anchorRef.current = anchor;
    if (anchorIndex < 0 || anchorIndex > LAST_INDEX) return;
    if (alignedStripRef.current !== stripWeeks) {
      alignedStripRef.current = stripWeeks;
      scrollToIndex(anchorIndex, "auto");
      return;
    }
    if (anchor.getTime() === reportedAnchorMsRef.current) {
      reportedAnchorMsRef.current = null;
      return;
    }
    scrollToIndex(anchorIndex, "smooth");
  }, [anchor, anchorIndex, scrollToIndex, stripWeeks]);

  const realign = useCallback(() => {
    if (alignedIndexRef.current === null) return false;
    scrollToIndex(alignedIndexRef.current, "auto");
    return true;
  }, [scrollToIndex]);
  useStripRealign({ scrollerRef, alignedSizeRef: alignedHeightRef, axis: "y", realign });

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
      // The day of the month carries over, so dropping into the week view lands where the user was.
      const reported = withDayOfMonth(focusDay, anchorRef.current.getDate());
      anchorRef.current = reported;
      reportedAnchorMsRef.current = reported.getTime();
      onAnchorChange(reported);
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
      const inTrackpadGesture = event.timeStamp - trackpadAtRef.current < TRACKPAD_GESTURE_MS;
      const notches = resolveWheelNotches(event, inTrackpadGesture);
      if (notches === 0) {
        trackpadAtRef.current = event.timeStamp;
        pendingIndexRef.current = null;
        setNotchedWheel(false);
        return;
      }
      setNotchedWheel(true);
      if (notchedWheel) event.preventDefault();
      // The first notch arrives uncancellable: one long enough to snap forward by itself is left to do so.
      else if (Math.abs(event.deltaY) >= rowHeight() / 2) return;
      const from = pendingIndexRef.current ?? resolveIndex(el);
      scrollToIndex(from + notches, "smooth");
    };
    el.addEventListener("wheel", handleWheel, { passive: !notchedWheel });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [notchedWheel, resolveIndex, rowHeight, scrollToIndex]);

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
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Vertical fade at the bottom only; a top fade would wash out the band the header dissolves into. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 mask-b-from-[calc(100%-24px)] mask-x-from-[calc(100%-24px)]"
          style={COLUMN_RULES}
        />
        {/* A pixel taller than its clip, so the bottom row's rule is cut off rather than doubling the frame's border. */}
        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          onScrollEnd={handleScrollEnd}
          onTouchMove={releasePending}
          onKeyDown={releasePending}
          className="relative -mb-px min-h-0 flex-1 snap-y snap-mandatory overflow-y-auto overscroll-y-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
