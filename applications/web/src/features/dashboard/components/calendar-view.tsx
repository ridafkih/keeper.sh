import { useMemo, useState } from "react";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import { cn } from "@/utils/cn";
import { Text } from "@/components/ui/primitives/text";
import { MonthGrid } from "./month-grid";
import { WeekGrid } from "./week-grid";
import {
  addDays,
  addMonths,
  formatMonthTitle,
  formatWeekTitle,
  getMonthGridDays,
} from "./calendar-helpers";

type CalendarViewMode = "week" | "month";

const VIEWS: CalendarViewMode[] = ["week", "month"];

const navButton =
  "flex size-8 items-center justify-center rounded-lg text-foreground-muted hover:bg-background-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The dashboard's calendar pane. Skeleton only: a titled, navigable grid with a
 * week/month view switcher and no events. Owns the visible range (`anchor`, any
 * date inside it) and the active `view`, and lets the user page the range.
 */
export function CalendarView() {
  const [view, setView] = useState<CalendarViewMode>("month");
  const [anchor, setAnchor] = useState(() => new Date());

  const monthDays = useMemo(() => getMonthGridDays(anchor), [anchor]);

  const title = view === "month" ? formatMonthTitle(anchor) : formatWeekTitle(anchor);

  const step = (direction: 1 | -1) => {
    setAnchor((current) =>
      view === "month" ? addMonths(current, direction) : addDays(current, direction * 7),
    );
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-border-elevated bg-background-elevated shadow-xs isolate">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <Text as="span" size="base" tone="default" className="font-medium">
          {title}
        </Text>
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-lg bg-background-hover p-0.5">
            {VIEWS.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-sm font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  mode === view
                    ? "bg-background-elevated text-foreground shadow-xs"
                    : "text-foreground-muted hover:text-foreground",
                )}
              >
                {mode}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-foreground-muted hover:bg-background-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setAnchor(new Date())}
            >
              Today
            </button>
            <button
              type="button"
              aria-label="Previous"
              className={cn(navButton)}
              onClick={() => step(-1)}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              aria-label="Next"
              className={cn(navButton)}
              onClick={() => step(1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </header>
      {view === "month" ? (
        <MonthGrid anchor={anchor} days={monthDays} />
      ) : (
        <WeekGrid anchor={anchor} onVisibleWeekChange={setAnchor} />
      )}
    </div>
  );
}
