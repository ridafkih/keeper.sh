import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { cn } from "@/utils/cn";
import { useStartOfToday } from "@/hooks/use-start-of-today";
import { Text } from "@/components/ui/primitives/text";
import { CalendarFrame } from "./calendar-frame";
import {
  addDays,
  formatHourLabel,
  HOURS,
  isSameDay,
  startOfDay,
  startOfVisibleWeek,
  WEEK_VIEW_DAYS,
} from "./calendar-helpers";

/** Width of the left time gutter, in pixels. */
const GUTTER_WIDTH = 52;
/** Height of a single hour row, in pixels. */
const HOUR_HEIGHT = 48;
/** Height of the weekday/date header row, in pixels. */
const HEADER_HEIGHT = 56;
/** Visible day columns (a week). */
const VISIBLE_COLUMNS = WEEK_VIEW_DAYS;
/** Offset of the centre column from the first visible one. */
const CENTER_OFFSET = Math.floor(VISIBLE_COLUMNS / 2);
/** Weeks buffered on each side of the entry range, giving the strip a long,
 * effectively-continuous horizontal scroll range without recentering logic. */
const BUFFER_WEEKS = 26;

const MS_PER_DAY = 86_400_000;

/** Colour of the hour rules across the grid: the column-rule token, faded so
 * the horizontal lines read as a secondary, quieter layer under the columns. */
const HOUR_RULE_COLOR = "color-mix(in oklab, var(--color-border-elevated) 45%, transparent)";

/** The day-column rules: a 1px line at the left edge of every column, tiled
 * one column apart. They are painted on the *viewport* boxes (the grid's
 * scroller and the header's strip viewport) rather than on the day cells, so
 * they are pinned to the visible area and run its full height — through a
 * vertical overscroll bounce too, instead of stopping at the content's edge.
 * Horizontal scrolling is followed via `--strip-scroll`, which `handleScroll`
 * keeps equal to the scroller's `scrollLeft`. Both boxes use the same column
 * width expression, so header and grid lines coincide to the pixel. */
const COLUMN_RULES: CSSProperties = {
  backgroundImage: "linear-gradient(to right, var(--color-border-elevated) 0 1px, transparent 1px)",
  backgroundRepeat: "repeat-x",
};

/** Fades the header's column rules out toward the top, so they dissolve into
 * the toolbar above instead of meeting it at a hard corner. */
const HEADER_RULE_FADE = "linear-gradient(to top, black 35%, transparent)";

/** Depth of the grid's top and bottom edge fades, in pixels. Shallow enough
 * to stay clear of the first and last hour labels at the scroll extremes. */
const GRID_EDGE_FADE_SIZE = 24;

/** Fades the grid's scroller out at its top and bottom edges, so rules,
 * labels and the current-time line dissolve into the page background instead
 * of stopping at a hard edge. Applied to the scroller box, so it stays pinned
 * to the visible area while the content scrolls beneath it — through a
 * vertical overscroll bounce too. Vertical only: a horizontal fade would dim
 * the time gutter's labels and the outermost day column. */
const GRID_EDGE_FADE = `linear-gradient(to bottom, transparent, black ${GRID_EDGE_FADE_SIZE}px, black calc(100% - ${GRID_EDGE_FADE_SIZE}px), transparent)`;

interface WeekGridProps {
  /** The day to centre the visible range on; drives the horizontal scroll
   * position. Today on entry, so today sits in the middle column. */
  anchor: Date;
  /** Reports the day now in the centre column after manual horizontal
   * scrolling, so the pane title and paging stay in sync with the strip. */
  onCenterDayChange: (centerDay: Date) => void;
  /** The pane's toolbar, rendered in the header card above the day row. */
  toolbar: ReactNode;
}

/**
 * The week view skeleton, modelled on qali's time strip: a pinned left time
 * gutter and a single two-axis scroller whose buffered day columns snap one
 * day at a time — so the week scrolls horizontally like qali's. The visible
 * range is a rolling seven days centred on `anchor` rather than a calendar
 * week, so "Today" puts today in the middle and paging keeps that alignment.
 * The day row lives in the header card above; it has no scroller of its own
 * and simply mirrors the grid's horizontal offset, so the two always line up.
 * Presentational only: no events; a current-time line marks today.
 */
export function WeekGrid({ anchor, onCenterDayChange, toolbar }: WeekGridProps) {
  const today = useStartOfToday();
  const router = useRouter();
  const scrollerRef = useRef<HTMLDivElement>(null);
  /** The overflow-hidden viewport around the day row, in the header card. */
  const headerStripRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  /** Tears down the one-shot "re-centre after the router restores scroll"
   * listener set up on mount, if it is still pending at unmount. */
  const restorationCleanupRef = useRef<(() => void) | null>(null);
  /** The centre day (ms, midnight) the strip is currently aligned to; guards
   * the anchor effect from re-scrolling in response to the strip's own scroll
   * reports. */
  const alignedCenterMsRef = useRef<number | null>(null);

  // The buffered strip is centred on the range active when the grid mounts, so
  // the entry range sits mid-buffer and paging stays inside it.
  const [stripDays] = useState(() => {
    const start = addDays(startOfVisibleWeek(anchor), -BUFFER_WEEKS * 7);
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

  /** Mirrors the scroller's horizontal offset onto the header's day row, and
   * into `--strip-scroll` on both boxes so their column rules follow along. */
  const syncHeaderStrip = useCallback(() => {
    const scroller = scrollerRef.current;
    const headerStrip = headerStripRef.current;
    if (!scroller || !headerStrip) return;
    headerStrip.scrollLeft = scroller.scrollLeft;
    const offset = `${scroller.scrollLeft}px`;
    scroller.style.setProperty("--strip-scroll", offset);
    headerStrip.style.setProperty("--strip-scroll", offset);
  }, []);

  /** Scrolls the strip so `centerDay` (midnight) sits in the middle column. */
  const scrollToCenter = useCallback(
    (centerDay: Date, behavior: ScrollBehavior) => {
      const el = scrollerRef.current;
      if (!el) return;
      const first = startOfVisibleWeek(centerDay);
      const index = Math.round((first.getTime() - stripDays[0].getTime()) / MS_PER_DAY);
      const clamped = Math.max(0, Math.min(index, stripDays.length - VISIBLE_COLUMNS));
      alignedCenterMsRef.current = centerDay.getTime();
      el.scrollTo({ left: clamped * columnWidth(), behavior });
      // An instant jump lands before any scroll event; mirror it right away so
      // the header never shows a stale range, even for a frame.
      if (behavior === "auto") syncHeaderStrip();
    },
    [columnWidth, stripDays, syncHeaderStrip],
  );

  // On mount, centre the anchor day and jump down to business hours (auto, no
  // animation); afterwards, smooth-scroll whenever the anchor moves to a
  // different day than the strip is centred on (button paging / Today).
  useLayoutEffect(() => {
    const centerDay = startOfDay(anchor);
    if (!mountedRef.current) {
      mountedRef.current = true;
      const center = () => {
        scrollToCenter(centerDay, "auto");
        const el = scrollerRef.current;
        if (el) el.scrollTop = Math.max(0, (new Date().getHours() - 1) * HOUR_HEIGHT);
      };
      center();
      // The router's scroll restoration replays this element's offsets from the
      // last visit right after the route renders — later in this same commit —
      // which would drag the strip back to wherever it was then. Centre again
      // once that has run. If it hasn't run by the next frame it won't for
      // this mount, so stop listening rather than re-centring on a later
      // navigation.
      const unsubscribe = router.subscribe("onRendered", () => {
        unsubscribe();
        center();
      });
      const frame = requestAnimationFrame(unsubscribe);
      restorationCleanupRef.current = () => {
        cancelAnimationFrame(frame);
        unsubscribe();
      };
      return;
    }
    if (centerDay.getTime() !== alignedCenterMsRef.current) {
      scrollToCenter(centerDay, "smooth");
    }
  }, [anchor, router, scrollToCenter]);

  // Column widths are a fraction of the scroller's width, but the horizontal
  // offset is kept in pixels — so a viewport resize would silently drift the
  // strip to different days. Re-snap to the day the strip was centred on
  // whenever the scroller's width changes.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      const width = el.clientWidth;
      if (width === 0 || width === lastWidth) return;
      lastWidth = width;
      const alignedCenterMs = alignedCenterMsRef.current;
      if (alignedCenterMs === null) return;
      scrollToCenter(new Date(alignedCenterMs), "auto");
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollToCenter]);

  const handleScroll = () => {
    // Mirror synchronously — not inside the rAF below — so the header never
    // trails the grid by a frame.
    syncHeaderStrip();
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = scrollerRef.current;
      if (!el) return;
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
      restorationCleanupRef.current?.();
    },
    [],
  );

  const dayRow = (
    <div className="flex" style={{ height: HEADER_HEIGHT }}>
      {/* Spacer over the grid's time gutter, keeping the columns aligned. */}
      <div className="shrink-0" style={{ width: GUTTER_WIDTH }} />
      <div ref={headerStripRef} className="relative min-w-0 flex-1 overflow-hidden">
        {/* Column rules, pinned to the viewport and faded toward the top. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            ...COLUMN_RULES,
            backgroundSize: `calc(100% / ${VISIBLE_COLUMNS}) 100%`,
            backgroundPositionX: "calc(0px - var(--strip-scroll, 0px))",
            maskImage: HEADER_RULE_FADE,
            WebkitMaskImage: HEADER_RULE_FADE,
          }}
        />
        <div
          className="relative grid h-full"
          style={{
            gridTemplateColumns: columnsTemplate,
            width: `calc(${stripDays.length} * 100% / ${VISIBLE_COLUMNS})`,
          }}
        >
          {stripDays.map((day) => {
            const isToday = isSameDay(day, today);
            return (
              <div
                key={day.getTime()}
                className="flex flex-col items-center justify-center gap-1"
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
        className="flex min-h-0 flex-1 items-start overflow-auto overscroll-x-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{
          ...COLUMN_RULES,
          backgroundSize: `calc((100% - ${GUTTER_WIDTH}px) / ${VISIBLE_COLUMNS}) 100%`,
          backgroundPositionX: `calc(${GUTTER_WIDTH}px - var(--strip-scroll, 0px))`,
          scrollSnapType: "x mandatory",
          scrollPaddingLeft: GUTTER_WIDTH,
          maskImage: GRID_EDGE_FADE,
          WebkitMaskImage: GRID_EDGE_FADE,
        }}
      >
        {/* Pinned time gutter; opaque in the page colour so the columns scroll
            under it. */}
        <div
          className="relative sticky left-0 z-30 shrink-0 bg-background"
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
        {/* Buffered day strip: 7 columns fill the viewport, the rest overflow. */}
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
              <div
                key={day.getTime()}
                className="relative"
                style={{ scrollSnapAlign: "start" }}
              >
                {/* Hour rules, painted per cell (one strip-wide layer is too
                    large a box for some engines to paint a background on) and
                    starting one row down, so neither the top nor the bottom
                    edge of the grid carries a line. */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 bottom-0"
                  style={{
                    top: HOUR_HEIGHT,
                    backgroundImage: `linear-gradient(to bottom, ${HOUR_RULE_COLOR} 0 1px, transparent 1px)`,
                    backgroundSize: `100% ${HOUR_HEIGHT}px`,
                  }}
                />
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
    </CalendarFrame>
  );
}
