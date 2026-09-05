import { memo } from "react";
import type { CSSProperties } from "react";
import { isEventPast } from "@/lib/time";
import type { CalendarEvent } from "@/hooks/use-events";
import { HOUR_HEIGHT } from "./calendar-helpers";
import { EventCard } from "./event-card";
import { layoutDayEvents, stackIndentPx, tileBox } from "./event-layout";
import type { PositionedEvent } from "./event-layout";

const CARD_INSET_LEFT_PX = 2;
const CARD_INSET_RIGHT_PX = 3;
const CARD_INSET_PX = CARD_INSET_LEFT_PX + CARD_INSET_RIGHT_PX;

// Elevation is capped below the current-time line (z-20, now-indicator.tsx) and sticky gutter (z-30); ties paint in DOM order.
const CARD_BASE_Z_INDEX = 1;
const MAX_CARD_ELEVATION = 8;

interface DayColumnProps {
  day: Date;
  /** Null except on today, so only today's column re-renders on the minute tick. */
  now: Date | null;
  events: CalendarEvent[];
}

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

export const DayColumn = memo(function DayColumn({ day, now, events }: DayColumnProps) {
  const positioned = layoutDayEvents(events, day);

  return (
    <div className="relative snap-start">
      {/* Hour rules, per cell — one strip-wide background layer is too large for some engines to paint. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 bg-[linear-gradient(to_bottom,var(--color-border-hour)_0_1px,transparent_1px)]"
        style={{ top: HOUR_HEIGHT, backgroundSize: `100% ${HOUR_HEIGHT}px` }}
      />
      {/* Reaches above midnight so rubber-band overscroll can't part the rule from the header. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-[100dvh] bottom-0 left-0 w-px bg-border-elevated"
      />
      {positioned.map((item) => (
        <EventCard
          key={item.event.id}
          event={item.event}
          past={isEventPast(item.event.endTime, now?.getTime())}
          layout="grid"
          style={resolveCardStyle(item)}
        />
      ))}
    </div>
  );
});
