import { useMemo, useState } from "react";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import { cn } from "@/utils/cn";
import { Text } from "@/components/ui/primitives/text";
import { MonthGrid } from "./month-grid";
import { addMonths, formatMonthTitle, getMonthGridDays, startOfMonth } from "./calendar-helpers";

const navButton =
  "flex size-8 items-center justify-center rounded-lg text-foreground-muted hover:bg-background-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The dashboard's month calendar pane. Skeleton only: a titled, navigable month
 * grid with no events. Owns the visible month (`anchor`, always the first of the
 * month) and lets the user page between months.
 */
export function CalendarView() {
  const [anchor, setAnchor] = useState(() => startOfMonth(new Date()));
  const days = useMemo(() => getMonthGridDays(anchor), [anchor]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-border-elevated bg-background-elevated shadow-xs">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <Text as="span" size="base" tone="default" className="font-medium">
          {formatMonthTitle(anchor)}
        </Text>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-foreground-muted hover:bg-background-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setAnchor(startOfMonth(new Date()))}
          >
            Today
          </button>
          <button
            type="button"
            aria-label="Previous month"
            className={cn(navButton)}
            onClick={() => setAnchor((current) => addMonths(current, -1))}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            aria-label="Next month"
            className={cn(navButton)}
            onClick={() => setAnchor((current) => addMonths(current, 1))}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </header>
      <MonthGrid anchor={anchor} days={days} />
    </div>
  );
}
