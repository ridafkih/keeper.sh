import { memo } from "react";
import type { CSSProperties } from "react";
import { tv } from "tailwind-variants/lite";
import { Text } from "@/components/ui/primitives/text";
import { formatTime, formatTimeRange, formatTimeUntil } from "@/lib/time";
import type { CalendarEvent } from "@/hooks/use-events";
import { EVENT_PILL_HEIGHT_PX } from "./event-layout";

type EventCardLayout = "list" | "grid";

interface EventCardProps {
  event: CalendarEvent;
  /** Whether the event has ended, which dims and strikes the card. Owned by
   * the parent rather than read from the clock here: the card is memoised, so
   * a clock read inside it would freeze at first render, while the parent
   * re-renders on whatever tick it already has (the events list on a data
   * refresh, the week grid's today column on its minute tick). */
  past: boolean;
  /** `list` (the default): the events page's stacked, content-sized card
   * with the relative time. `grid`: a week-grid card whose height is its
   * event's duration and whose content steps down with that height — see
   * the height bands on `eventCard`. */
  layout?: EventCardLayout;
  /** Placement for the `grid` layout: the column sets `top`/`height`/`left`/
   * `width` and the stacking order. */
  style?: CSSProperties;
}

/**
 * Height bands for the grid layout, at the week grid's 48px hour (0.8px a
 * minute), with the card's 4px vertical padding, a 16px text-xs line and a
 * 20px text-sm line. The grid card is a size-query container named
 * `event-card`, and the `event-*` variants in `index.css` select on its
 * rendered height:
 *
 *   compact  < 27px   (≤ 30 min)  title (xs), centred, no padding   16px
 *   short    < 43px   (≤ 50 min)  title (sm)                        28px
 *   default  43–58px  (≤ 70 min)  time (xs) + title                 44px
 *   roomy    59–74px  (≤ 90 min)  + one description line            60px
 *   tall     ≥ 75px   (≥ 95 min)  + two description lines           76px
 *
 * Width has one band of its own: below 72px (`event-narrow` — a two- or
 * three-way tile in a 136px column) the time line and description go and
 * the title tightens, since neither end of a time range would fit.
 *
 * Each band's floor sits 1px under its content height (see the variants for
 * why), so `overflow-hidden` only ever clips a pixel of padding, never
 * glyphs. `min-h-5` floors a 15-minute card at 20px —
 * drawn a little taller than its duration so the title still reads, the
 * trade every calendar makes for sub-hour events.
 *
 * Positioning and spacing live on the layout variants rather than `base`:
 * `cn` is plain clsx, so two `position` or `py-*` utilities would be resolved
 * by Tailwind's output order, not by the variant chosen.
 */
const eventCard = tv({
  base: "overflow-hidden before:absolute before:w-0.5 before:rounded-full before:bg-event-border",
  variants: {
    layout: {
      list: "relative flex flex-col gap-0.5 rounded-xl py-2.5 pr-3 pl-4 before:inset-y-2 before:left-1.5",
      // `@container-[size]/event-card` makes the card the size container the
      // `event-*` variants query. Grid only: size containment detaches a
      // box's height from its content — right for a card whose height is its
      // duration, but it would collapse a content-sized list card to nothing.
      // The card carries no padding of its own: a size container's queries
      // measure its content box, so padding here would shrink every band.
      // The ring is the page colour: invisible against the grid, it cuts a
      // card out from any card it overlaps so the stack's edges stay legible.
      grid: "absolute @container-[size]/event-card min-h-5 rounded-lg ring-1 ring-background before:inset-y-1 before:left-1",
    },
    // Past cards recede on a muted (still opaque) fill with their content and
    // accent bar dimmed — never opacity on the card itself, which would let a
    // card beneath show through in a stack. The fill lives on both branches
    // rather than `base`, as two `bg-*` utilities would be left to Tailwind's
    // output order.
    past: {
      true: "bg-event-background-muted line-through before:opacity-50 *:opacity-50",
      false: "bg-event-background",
    },
  },
  defaultVariants: {
    layout: "list",
  },
});

/**
 * A tinted event card: the time range, a bold title (falling back to the
 * calendar name), and the description when the calendar shares it. Shared by
 * the events page (`list`) and the calendar pane (`grid`).
 */
export const EventCard = memo(function EventCard({
  event,
  past,
  layout = "list",
  style,
}: EventCardProps) {
  const title = event.title ?? event.calendarName;
  const classes = eventCard({ layout, past });

  if (layout === "grid") {
    return (
      <div className={classes} style={style}>
        {/* The padding and the compact band's centring sit on this body
            rather than the card: a container's queries never match the
            container itself, only its descendants. */}
        <div className="flex h-full flex-col py-1 pr-2 pl-3 event-compact:justify-center event-compact:py-0 event-narrow:pr-1 event-narrow:pl-2">
          <Text
            size="xs"
            tone="eventMuted"
            className="truncate tabular-nums event-short:hidden event-narrow:hidden"
          >
            {formatTimeRange(event.startTime, event.endTime)}
          </Text>
          {/* No `leading-*` here: the `text-xs` steps bring the xs line-height
              along with the size. */}
          <Text
            size="sm"
            tone="event"
            className="truncate font-semibold event-compact:text-xs event-narrow:text-xs"
          >
            {title}
          </Text>
          {event.description && (
            <Text
              size="xs"
              tone="eventMuted"
              className="hidden event-roomy:line-clamp-1 event-tall:line-clamp-2 event-narrow:hidden"
            >
              {event.description}
            </Text>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={classes} style={style}>
      <div className="flex items-center justify-between gap-2">
        <Text size="sm" tone="eventMuted" className="tabular-nums">
          {formatTime(event.startTime)} - {formatTime(event.endTime)}
        </Text>
        <Text size="xs" tone="eventMuted" className="tabular-nums whitespace-nowrap">
          {formatTimeUntil(event.startTime)}
        </Text>
      </div>
      <Text size="sm" tone="event" className="truncate font-semibold">
        {title}
      </Text>
      {event.description && (
        <Text size="sm" tone="eventMuted" className="line-clamp-2">
          {event.description}
        </Text>
      )}
    </div>
  );
});

interface EventPillProps {
  event: CalendarEvent;
  /** Whether the event has ended; see `EventCardProps.past`. */
  past: boolean;
}

const eventPill = tv({
  base: "relative flex shrink-0 items-center overflow-hidden rounded-sm pr-1.5 pl-3 before:absolute before:inset-y-[3px] before:left-1 before:w-0.5 before:rounded-full before:bg-event-border",
  variants: {
    past: {
      true: "bg-event-background-muted line-through before:opacity-50 *:opacity-50",
      false: "bg-event-background",
    },
  },
});

/**
 * A one-line event pill — the card's surface and accent bar at pill height —
 * for the week view's all-day band and the month grid's day cells.
 */
export const EventPill = memo(function EventPill({ event, past }: EventPillProps) {
  return (
    <div className={eventPill({ past })} style={{ height: EVENT_PILL_HEIGHT_PX }}>
      {/* `min-w-0` lets the flex item shrink below its text so `truncate` bites. */}
      <Text as="span" size="xs" tone="event" className="min-w-0 truncate font-medium">
        {event.title ?? event.calendarName}
      </Text>
    </div>
  );
});

interface EventPillOverflowProps {
  /** How many of the day's events are folded away. */
  count: number;
}

/** The "+N more" row that stands in for the pills a day has no room for. */
export function EventPillOverflow({ count }: EventPillOverflowProps) {
  return (
    <Text
      as="span"
      size="xs"
      tone="muted"
      className="flex shrink-0 items-center truncate px-1.5"
      style={{ height: EVENT_PILL_HEIGHT_PX }}
    >
      +{count} more
    </Text>
  );
}
