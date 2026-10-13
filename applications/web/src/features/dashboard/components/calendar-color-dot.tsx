import { cn } from "@/utils/cn";
import { resolveEventTint } from "./event-card.styles";

interface CalendarColorDotProps {
  color: string | null;
  className?: string;
}

export function CalendarColorDot({ color, className }: CalendarColorDotProps) {
  const tint = resolveEventTint(color);
  return (
    <span
      aria-hidden
      className={cn("size-1.5 shrink-0 rounded-full bg-(--event-accent)", tint.className, className)}
      style={tint.style}
    />
  );
}
