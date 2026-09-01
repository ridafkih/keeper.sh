import { cn } from "@/utils/cn";

export const EVENT_COLORS = {
  blue: cn(
    "[--event-ink:var(--color-blue-900)] [--event-surface:var(--color-blue-100)] [--event-accent:var(--color-blue-500)]",
    "dark:[--event-ink:var(--color-blue-100)] dark:[--event-surface:color-mix(in_srgb,var(--color-blue-500)_20%,var(--color-background))] dark:[--event-accent:var(--color-blue-400)]",
  ),
};

export type EventColor = keyof typeof EVENT_COLORS;
