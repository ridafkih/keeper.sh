import type { PropsWithChildren } from "react";
import { tv } from "tailwind-variants/lite";

/**
 * A dated list where the label stays beside its entry while that entry scrolls.
 *
 * Compose it as `Timeline > TimelineEntry > TimelineAside + TimelineContent`.
 * The aside sticks inside its own entry, so it releases at the entry's bottom
 * edge and the next entry's aside takes over. Below `sm` the two slots stack
 * and the aside stops sticking, because a narrow column has nowhere to pin.
 */

const timeline = tv({
  base: "flex flex-col gap-8 list-none",
});

const timelineEntry = tv({
  base: "grid grid-cols-1 gap-x-8 gap-y-3 border-t border-interactive-border pt-8 first:border-t-0 first:pt-0",
  variants: {
    aside: {
      narrow: "sm:grid-cols-[7rem_minmax(0,1fr)]",
      wide: "sm:grid-cols-[11rem_minmax(0,1fr)]",
    },
  },
  defaultVariants: {
    aside: "narrow",
  },
});

/** `self-start` keeps the grid item from stretching, which would defeat `sticky`. */
const timelineAside = tv({
  base: "flex flex-col gap-1 sm:sticky sm:top-24 sm:self-start",
});

const timelineContent = tv({
  base: "flex min-w-0 flex-col gap-6",
});

type TimelineProps = PropsWithChildren<{ className?: string }>;
type TimelineEntryProps = PropsWithChildren<{
  aside?: "narrow" | "wide";
  className?: string;
  id?: string;
}>;

export function Timeline({ children, className }: TimelineProps) {
  return <ol className={timeline({ className })}>{children}</ol>;
}

export function TimelineEntry({ children, aside, className, id }: TimelineEntryProps) {
  return (
    <li className={timelineEntry({ aside, className })} id={id}>
      {children}
    </li>
  );
}

export function TimelineAside({ children, className }: TimelineProps) {
  return <div className={timelineAside({ className })}>{children}</div>;
}

export function TimelineContent({ children, className }: TimelineProps) {
  return <div className={timelineContent({ className })}>{children}</div>;
}
