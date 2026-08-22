import { memo } from "react";
import type { CSSProperties } from "react";
import { isEventPast } from "@/lib/time";
import type { CalendarEvent } from "@/hooks/use-events";
import { HOUR_HEIGHT } from "./calendar-helpers";
import { EventCard } from "./event-card";
import { layoutDayEvents, stackIndentPx, tileBox } from "./event-layout";
import type { PositionedEvent } from "./event-layout";

/** Card insets from the column's edges, in pixels: clear of the 1px column
 * rule on the left, and a hairline short of the next column on the right. */
const CARD_INSET_LEFT_PX = 2;
const CARD_INSET_RIGHT_PX = 3;
const CARD_INSET_PX = CARD_INSET_LEFT_PX + CARD_INSET_RIGHT_PX;

/** Cards stack from this z-index upward by elevation, capped so a deep
 * cluster never climbs over the current-time line (z-20) or the sticky time
 * gutter (z-30). Cards at the cap tie, and ties paint in DOM order — start
 * order — so the cascade still reads. */
const CARD_BASE_Z_INDEX = 1;
const MAX_CARD_ELEVATION = 8;

interface DayColumnProps {
  /** Midnight on the column's day. Identity-stable (from the strip's frozen
   * day list), so the memo holds across renders. */
  day: Date;
  isToday: boolean;
  /** Today's current time as a fraction of the day; null for other days (and
   * until the client resolves it), so only today's column re-renders on the
   * minute tick. */
  nowFraction: number | null;
  /** The timed events overlapping this day. Identity-stable while unchanged. */
  events: CalendarEvent[];
}

/** Places a laid-out event in the column: vertical by day fraction (like the
 * current-time line), horizontal by cascade indent or tile column, with the
 * insets applied. */
function resolveCardStyle(item: PositionedEvent): CSSProperties {
  let left: string;
  let width: string;
  if (item.tiled) {
    const box = tileBox(item.columnIndex, item.columnCount, item.columnSpan);
    left = `calc(${box.left * 100}% + ${CARD_INSET_LEFT_PX}px)`;
    width = `calc(${box.width * 100}% - ${CARD_INSET_PX}px)`;
  } else {
    const indent = stackIndentPx(item.stackIndex);
    left = `${CARD_INSET_LEFT_PX + indent}px`;
    width = `calc(100% - ${CARD_INSET_PX + indent}px)`;
  }
  return {
    top: `${item.topFraction * 100}%`,
    height: `${item.heightFraction * 100}%`,
    left,
    width,
    zIndex: CARD_BASE_Z_INDEX + Math.min(item.elevation, MAX_CARD_ELEVATION),
  };
}

/**
 * One day column of the week grid: the hour rules, the day's event cards laid
 * out by `layoutDayEvents`, and the current-time line on today. Memoised so a
 * scroll-driven anchor change — which re-renders the whole strip — only
 * re-renders the columns whose events or "now" actually changed.
 */
export const DayColumn = memo(function DayColumn({
  day,
  isToday,
  nowFraction,
  events,
}: DayColumnProps) {
  const positioned = layoutDayEvents(events, day);

  return (
    <div className="relative snap-start">
      {/* Hour rules, painted per cell (one strip-wide layer is too large a
          box for some engines to paint a background on) and starting one row
          down, so neither the top nor the bottom edge of the grid carries a
          line. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 bg-[linear-gradient(to_bottom,var(--color-border-hour)_0_1px,transparent_1px)]"
        style={{ top: HOUR_HEIGHT, backgroundSize: `100% ${HOUR_HEIGHT}px` }}
      />
      {positioned.map((item) => (
        <EventCard
          key={item.event.id}
          event={item.event}
          past={isEventPast(item.event.endTime)}
          layout="grid"
          style={resolveCardStyle(item)}
        />
      ))}
      {/* Above the event cards, below the sticky time gutter. */}
      {isToday && nowFraction != null && (
        <div
          className="pointer-events-none absolute inset-x-0 z-20 h-0.5 -translate-y-1/2 bg-red-500"
          style={{ top: `${nowFraction * 100}%` }}
        />
      )}
    </div>
  );
});
