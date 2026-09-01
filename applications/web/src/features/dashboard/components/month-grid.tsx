import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/utils/cn";
import { useStartOfToday } from "@/hooks/use-start-of-today";
import { Text } from "@/components/ui/primitives/text";
import { CalendarFrame } from "./calendar-frame";
import { isSameDay, isSameMonth, WEEKDAY_LABELS } from "./calendar-helpers";

const COLUMNS = 7;
const ROWS = 6;

const EDGE_FADE_SIZE = 24;

// Cell rules on their own layer behind the cells, so they can fade at the edges without touching the day numbers.
const CELL_RULES: CSSProperties = {
  backgroundImage: [
    "linear-gradient(to right, transparent calc(100% - 1px), var(--color-border-elevated) calc(100% - 1px))",
    "linear-gradient(to bottom, transparent calc(100% - 1px), var(--color-border-elevated) calc(100% - 1px))",
  ].join(", "),
  backgroundSize: `calc(100% / ${COLUMNS}) 100%, 100% calc(100% / ${ROWS})`,
  backgroundRepeat: "repeat-x, repeat-y",
};

const EDGE_FADE = [
  `linear-gradient(to bottom, transparent, black ${EDGE_FADE_SIZE}px, black calc(100% - ${EDGE_FADE_SIZE}px), transparent)`,
  `linear-gradient(to right, transparent, black ${EDGE_FADE_SIZE}px, black calc(100% - ${EDGE_FADE_SIZE}px), transparent)`,
].join(", ");
const RULE_LAYER_STYLE: CSSProperties = {
  ...CELL_RULES,
  maskImage: EDGE_FADE,
  WebkitMaskImage: EDGE_FADE,
  maskComposite: "intersect",
  WebkitMaskComposite: "source-in",
};

interface MonthGridProps {
  anchor: Date;
  days: Date[];
  toolbar: ReactNode;
}

export function MonthGrid({ anchor, days, toolbar }: MonthGridProps) {
  const today = useStartOfToday();

  return (
    <CalendarFrame
      toolbar={toolbar}
      columnHeader={
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
      }
    >
      <div className="relative min-h-0 flex-1">
        <div aria-hidden className="pointer-events-none absolute inset-0" style={RULE_LAYER_STYLE} />
        <div className="relative grid h-full grid-cols-7 grid-rows-6">
          {days.map((day) => {
            const inMonth = isSameMonth(day, anchor);
            const isToday = isSameDay(day, today);
            return (
              <div
                key={day.getTime()}
                className="flex min-h-0 flex-col gap-0.5 overflow-hidden p-1.5"
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
    </CalendarFrame>
  );
}
