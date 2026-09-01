import { memo } from "react";
import type { CSSProperties, PropsWithChildren } from "react";
import { tv } from "tailwind-variants/lite";
import { cn } from "@/utils/cn";
import { Text } from "@/components/ui/primitives/text";
import { formatTime, formatTimeRange, formatTimeUntil } from "@/lib/time";
import type { CalendarEvent } from "@/hooks/use-events";
import { EVENT_COLORS } from "./event-card.styles";
import type { EventColor } from "./event-card.styles";
import { EVENT_PILL_HEIGHT_PX } from "./event-layout";

type EventCardLayout = "list" | "grid";

const eventText = tv({
  base: "tracking-tight",
  variants: {
    size: {
      sm: "text-sm",
      xs: "text-xs",
    },
    muted: {
      true: "text-(--event-ink)/70",
      false: "text-(--event-ink)",
    },
  },
  defaultVariants: {
    muted: false,
  },
});

type EventTextProps = PropsWithChildren<{
  as?: "p" | "span";
  size: "sm" | "xs";
  muted?: boolean;
  className?: string;
}>;

export function EventText({ as = "p", size, muted, className, children }: EventTextProps) {
  const Element = as;
  return <Element className={eventText({ size, muted, className })}>{children}</Element>;
}

interface EventCardProps {
  event: CalendarEvent;
  /** Parent-owned: the memoised card can't watch the clock. */
  past: boolean;
  layout?: EventCardLayout;
  style?: CSSProperties;
  color?: EventColor;
}

// Grid height bands (48px hour): each floor sits 1px under its content height so rounding never clips glyphs.
const eventCard = tv({
  base: "overflow-hidden before:absolute before:w-0.5 before:rounded-full before:bg-(--event-accent)",
  variants: {
    layout: {
      list: "relative flex flex-col gap-0.5 rounded-xl py-2.5 pr-3 pl-4 before:inset-y-2 before:left-1.5",
      // Size containment is grid-only — it would collapse the content-sized list card.
      // The page-colour ring cuts a card out of any card it overlaps.
      grid: "absolute @container-[size]/event-card min-h-5 rounded-lg ring-1 ring-background before:inset-y-1 before:left-1",
    },
    // The muted fill stays opaque — card opacity would let a stacked card beneath show through.
    past: {
      true: "bg-[color-mix(in_srgb,var(--event-surface)_50%,var(--color-background))] line-through before:opacity-50 *:opacity-50",
      false: "bg-(--event-surface)",
    },
  },
  defaultVariants: {
    layout: "list",
  },
});

export const EventCard = memo(function EventCard({
  event,
  past,
  layout = "list",
  style,
  color = "blue",
}: EventCardProps) {
  const title = event.title ?? event.calendarName;
  const classes = cn(eventCard({ layout, past }), EVENT_COLORS[color]);

  if (layout === "grid") {
    // Clicks are delegated via `data-event-id` in WeekGrid, so the memoised tree never sees a handler.
    return (
      <button
        type="button"
        data-event-id={event.id}
        className={cn(
          classes,
          "cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
        style={style}
      >
        {/* Padding and centring sit on the body: a container's queries never match the container itself. */}
        <div className="flex h-full flex-col py-1 pr-2 pl-3 event-compact:justify-center event-compact:py-0 event-narrow:pr-1 event-narrow:pl-2">
          <EventText
            size="xs"
            muted
            className="truncate tabular-nums event-short:hidden event-narrow:hidden"
          >
            {formatTimeRange(event.startTime, event.endTime)}
          </EventText>
          <EventText
            size="sm"
            className="truncate font-semibold event-compact:text-xs event-narrow:text-xs"
          >
            {title}
          </EventText>
          {event.description && (
            <EventText
              size="xs"
              muted
              className="hidden event-roomy:line-clamp-1 event-tall:line-clamp-2 event-narrow:hidden"
            >
              {event.description}
            </EventText>
          )}
        </div>
      </button>
    );
  }

  return (
    <div className={classes} style={style}>
      <div className="flex items-center justify-between gap-2">
        <EventText size="sm" muted className="tabular-nums">
          {formatTime(event.startTime)} - {formatTime(event.endTime)}
        </EventText>
        <EventText size="xs" muted className="tabular-nums whitespace-nowrap">
          {formatTimeUntil(event.startTime)}
        </EventText>
      </div>
      <EventText size="sm" className="truncate font-semibold">
        {title}
      </EventText>
      {event.description && (
        <EventText size="sm" muted className="line-clamp-2">
          {event.description}
        </EventText>
      )}
    </div>
  );
});

interface EventPillProps {
  event: CalendarEvent;
  past: boolean;
  color?: EventColor;
}

const eventPill = tv({
  base: "relative flex shrink-0 items-center overflow-hidden rounded-sm pr-1.5 pl-3 before:absolute before:inset-y-[3px] before:left-1 before:w-0.5 before:rounded-full before:bg-(--event-accent)",
  variants: {
    past: {
      true: "bg-[color-mix(in_srgb,var(--event-surface)_50%,var(--color-background))] line-through before:opacity-50 *:opacity-50",
      false: "bg-(--event-surface)",
    },
  },
});

export const EventPill = memo(function EventPill({ event, past, color = "blue" }: EventPillProps) {
  return (
    <div className={cn(eventPill({ past }), EVENT_COLORS[color])} style={{ height: EVENT_PILL_HEIGHT_PX }}>
      <EventText as="span" size="xs" className="min-w-0 truncate font-medium">
        {event.title ?? event.calendarName}
      </EventText>
    </div>
  );
});

interface EventPillOverflowProps {
  count: number;
}

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
