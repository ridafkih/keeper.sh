import { cn } from "@/utils/cn";
import { useStartOfToday } from "@/hooks/use-start-of-today";
import { Text } from "@/components/ui/primitives/text";
import { isSameDay, isSameMonth, WEEKDAY_LABELS } from "./calendar-helpers";

interface MonthGridProps {
  /** Any date within the month being displayed (dims days outside it). */
  anchor: Date;
  /** The 42 days of the 6×7 grid, from `getMonthGridDays`. */
  days: Date[];
}

/**
 * The month grid skeleton: a weekday header over a 6×7 grid of day cells.
 * Presentational only — no events are rendered yet; each cell reserves space
 * where event pills will later go.
 */
export function MonthGrid({ anchor, days }: MonthGridProps) {
  const today = useStartOfToday();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-7">
        {WEEKDAY_LABELS.map((label) => (
          <Text
            key={label}
            as="span"
            size="xs"
            tone="muted"
            className="px-2 py-2 font-medium uppercase tracking-wide"
          >
            {label}
          </Text>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 border-t border-border-elevated">
        {days.map((day) => {
          const inMonth = isSameMonth(day, anchor);
          const isToday = isSameDay(day, today);
          return (
            <div
              key={day.getTime()}
              className={cn(
                "flex min-h-0 flex-col gap-0.5 overflow-hidden border-r border-b border-border-elevated p-1.5 [&:nth-child(7n)]:border-r-0 [&:nth-last-child(-n+7)]:border-b-0",
                !inMonth && "bg-background-hover/40",
              )}
            >
              <span
                className={cn(
                  "flex size-6 items-center justify-center self-start text-xs font-medium tabular-nums",
                  isToday && "rounded-full bg-emerald-400 text-neutral-950",
                  !isToday && inMonth && "text-foreground",
                  !isToday && !inMonth && "text-foreground-disabled",
                )}
              >
                {day.getDate()}
              </span>
              {/* Event pills will render here in a later stage. */}
              <div className="min-h-0 flex-1" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
