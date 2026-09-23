import type { CSSProperties } from "react";
import type { CalendarEvent } from "@/hooks/use-events";

export const EVENT_BLUE = "event-blue";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

interface EventTint {
  className: string;
  style: CSSProperties | undefined;
}

export const resolveEventColor = (event: Pick<CalendarEvent, "color" | "calendarColor">): string | null =>
  event.color ?? event.calendarColor;

export const resolveEventTint = (color: string | null): EventTint => {
  if (!color || !HEX_COLOR.test(color)) return { className: EVENT_BLUE, style: undefined };
  return {
    className: "event-tint",
    style: { "--event-color": color } as CSSProperties,
  };
};
