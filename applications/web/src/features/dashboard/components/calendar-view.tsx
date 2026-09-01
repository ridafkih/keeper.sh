import { useMemo, useState } from "react";
import { flushSync } from "react-dom";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import { cn } from "@/utils/cn";
import { Text } from "@/components/ui/primitives/text";
import { useEventsInRange } from "@/hooks/use-events";
import { MonthGrid } from "./month-grid";
import { WeekGrid } from "./week-grid";
import { bucketEventsByDay } from "./event-layout";
import {
  addDays,
  addMonths,
  formatMonthTitle,
  formatWeekTitle,
  getMonthFetchRange,
  getMonthGridDays,
  getWeekFetchRange,
} from "./calendar-helpers";

type CalendarViewMode = "week" | "month";

const VIEWS: CalendarViewMode[] = ["week", "month"];

const navButton =
  "flex size-8 items-center justify-center rounded-lg text-foreground-muted hover:bg-background-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function CalendarView() {
  const [view, setView] = useState<CalendarViewMode>("week");
  const [anchor, setAnchor] = useState(() => new Date());

  const monthDays = useMemo(() => getMonthGridDays(anchor), [anchor]);

  const fetchRange = view === "month" ? getMonthFetchRange(anchor) : getWeekFetchRange(anchor);
  const { events } = useEventsInRange(fetchRange.start, fetchRange.end);
  // Keyed on the window's instants, not `anchor`: the anchor moves on every scroll step, the window doesn't.
  const fetchStartMs = fetchRange.start.getTime();
  const fetchEndMs = fetchRange.end.getTime();
  const eventsByDay = useMemo(
    () => bucketEventsByDay(events, new Date(fetchStartMs), new Date(fetchEndMs)),
    [events, fetchStartMs, fetchEndMs],
  );

  const title = view === "month" ? formatMonthTitle(anchor) : formatWeekTitle(anchor);

  const switchView = (mode: CalendarViewMode) => {
    if (mode === view) return;
    const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || typeof document.startViewTransition !== "function") {
      setView(mode);
      return;
    }
    document.startViewTransition(() => {
      flushSync(() => setView(mode));
    });
  };

  const step = (direction: 1 | -1) => {
    setAnchor((current) =>
      view === "month" ? addMonths(current, direction) : addDays(current, direction * 7),
    );
  };

  const toolbar = (
    <>
      <Text as="span" size="base" tone="default" className="font-medium">
        {title}
      </Text>
      <div className="flex items-center gap-3">
        <div className="flex items-center rounded-lg bg-background-hover p-0.5">
          {VIEWS.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => switchView(mode)}
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
            className={navButton}
            onClick={() => step(-1)}
          >
            <ChevronLeft size={16} />
          </button>
          <button type="button" aria-label="Next" className={navButton} onClick={() => step(1)}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </>
  );

  return view === "month" ? (
    <MonthGrid anchor={anchor} days={monthDays} eventsByDay={eventsByDay} toolbar={toolbar} />
  ) : (
    <WeekGrid
      anchor={anchor}
      eventsByDay={eventsByDay}
      onCenterDayChange={setAnchor}
      toolbar={toolbar}
    />
  );
}
