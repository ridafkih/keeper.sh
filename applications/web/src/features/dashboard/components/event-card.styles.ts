import type { CSSProperties } from "react";
import { cn } from "@/utils/cn";
import type { CalendarEvent } from "@/hooks/use-events";

export const EVENT_COLORS = {
  blue: cn(
    "[--event-ink:var(--color-blue-900)] [--event-surface:var(--color-blue-100)] [--event-accent:var(--color-blue-500)]",
    "dark:[--event-ink:var(--color-blue-100)] dark:[--event-surface:color-mix(in_srgb,var(--color-blue-500)_20%,var(--color-background))] dark:[--event-accent:var(--color-blue-400)]",
  ),
};

interface EventTint {
  className: string;
  style: CSSProperties | undefined;
}

export const resolveEventColor = (event: Pick<CalendarEvent, "color" | "calendarColor">): string | null =>
  event.color ?? event.calendarColor;

export const resolveEventTint = (hex: string | null): EventTint => {
  if (!hex) return { className: EVENT_COLORS.blue, style: undefined };
  return {
    className: cn(EVENT_COLORS.blue, "event-tint"),
    style: { "--event-color": hex } as CSSProperties,
  };
};
