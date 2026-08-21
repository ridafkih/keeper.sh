import { useEffect, useState } from "react";
import { cn } from "@/utils/cn";
import { useStartOfToday } from "@/hooks/use-start-of-today";
import { Text } from "@/components/ui/primitives/text";
import { formatHourLabel, HOURS, isSameDay } from "./calendar-helpers";

/** Width of the left time gutter, in pixels. */
const GUTTER_WIDTH = 52;
/** Height of a single hour row, in pixels. */
const HOUR_HEIGHT = 48;

const MS_PER_DAY = 86_400_000;

interface WeekGridProps {
  /** The 7 days of the week, from `getWeekDays`. */
  days: Date[];
}

/**
 * The week grid skeleton, modelled on qali's time strip: a left time gutter of
 * hour labels, a header row of the 7 days, and a scrollable 24-hour body with a
 * column per day. Presentational only — no events; a faint current-time line
 * marks today when it is in view.
 */
export function WeekGrid({ days }: WeekGridProps) {
  const today = useStartOfToday();
  const columnsTemplate = `${GUTTER_WIDTH}px repeat(7, minmax(0, 1fr))`;

  // Resolve the current-time line on the client only, so SSR and hydration
  // agree (the server has no stable "now").
  const [nowFraction, setNowFraction] = useState<number | null>(null);
  useEffect(() => {
    const update = () => {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      setNowFraction((now.getTime() - startOfDay.getTime()) / MS_PER_DAY);
    };
    update();
    const interval = globalThis.setInterval(update, 60_000);
    return () => globalThis.clearInterval(interval);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        className="grid shrink-0 border-b border-border-elevated"
        style={{ gridTemplateColumns: columnsTemplate }}
      >
        {/* Gutter corner. */}
        <div />
        {days.map((day) => {
          const isToday = isSameDay(day, today);
          return (
            <div
              key={day.getTime()}
              className="flex flex-col items-center gap-1 border-l border-border-elevated py-2"
            >
              <Text as="span" size="xs" tone="muted" className="font-medium uppercase tracking-wide">
                {day.toLocaleDateString("en-US", { weekday: "short" })}
              </Text>
              <span
                className={cn(
                  "flex size-6 items-center justify-center text-xs font-medium tabular-nums",
                  isToday ? "rounded-full bg-emerald-400 text-neutral-950" : "text-foreground",
                )}
              >
                {day.getDate()}
              </span>
            </div>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className="relative grid"
          style={{
            gridTemplateColumns: columnsTemplate,
            height: HOUR_HEIGHT * HOURS.length,
          }}
        >
          <div className="relative">
            {HOURS.slice(1).map((hour) => (
              <span
                key={hour}
                className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-foreground-muted"
                style={{ top: hour * HOUR_HEIGHT }}
              >
                {formatHourLabel(hour)}
              </span>
            ))}
          </div>
          {days.map((day) => {
            const isToday = isSameDay(day, today);
            return (
              <div
                key={day.getTime()}
                className="relative border-l border-border-elevated"
                style={{
                  backgroundImage:
                    "linear-gradient(to bottom, var(--color-border-elevated) 0 1px, transparent 1px)",
                  backgroundSize: `100% ${HOUR_HEIGHT}px`,
                }}
              >
                {/* Event blocks will render here in a later stage. */}
                {isToday && nowFraction != null && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-10 h-0.5 -translate-y-1/2 bg-red-500"
                    style={{ top: `${nowFraction * 100}%` }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
