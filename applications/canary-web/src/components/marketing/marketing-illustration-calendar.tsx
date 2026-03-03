import { useAtomValue } from "jotai";
import { motion } from "motion/react";
import type { TargetAndTransition } from "motion/react";
import { memo, type PropsWithChildren } from "react";
import { calendarEmphasizedAtom } from "../../state/calendar-emphasized";

export interface Skew extends TargetAndTransition {
  rotate: number;
  x: number;
  y: number;
}

export type SkewTuple = [Skew, Skew, Skew];

const CALENDAR_COLUMNS = 7;
const CALENDAR_ROWS = 6;
const CALENDAR_DAYS_IN_MONTH = 31;
const CALENDAR_CELLS = CALENDAR_COLUMNS * CALENDAR_ROWS;
const CALENDAR_ANIMATION_EASE = [0.16, 0.85, 0.2, 1] as const;

const CALENDAR_DAY_NUMBERS = Array.from(
  { length: CALENDAR_CELLS },
  (_, index) => (index % CALENDAR_DAYS_IN_MONTH) + 1,
);

interface MarketingIllustrationCalendarCardProps {
  skew: SkewTuple;
}

const toMotionTarget = ({ rotate, x, y }: Skew) => ({ rotate, x, y });
const getAnimatedSkew = (skew: SkewTuple, emphasized: boolean) =>
  toMotionTarget(emphasized ? skew[2] : skew[1]);
const transformTemplate = ({
  x,
  y,
  rotate,
}: {
  x?: unknown;
  y?: unknown;
  rotate?: unknown;
}) =>
  `translateX(${String(x ?? 0)}) translateY(${String(y ?? 0)}) rotate(${String(rotate ?? 0)})`;

interface CalendarDayProps {
  day: number;
}

const CalendarDay = memo(function CalendarDay({ day }: CalendarDayProps) {
  return (
    <div className="bg-background aspect-square flex justify-center py-2 text-[0.625rem] text-foreground-muted">
      {day}
    </div>
  );
});

const CalendarGrid = memo(function CalendarGrid() {
  return (
    <div
      className="grid grid-cols-7 rounded-[0.875rem] gap-0.5 overflow-hidden"
      style={{ gridTemplateColumns: `repeat(${CALENDAR_COLUMNS}, minmax(0, 1fr))` }}
    >
      {CALENDAR_DAY_NUMBERS.map((day, index) => (
        <CalendarDay key={index} day={day} />
      ))}
    </div>
  );
});

export function MarketingIllustrationCalendarCard({
  skew,
}: MarketingIllustrationCalendarCardProps) {
  const emphasized = useAtomValue(calendarEmphasizedAtom);

  return (
    <motion.div
      initial={toMotionTarget(skew[0])}
      animate={getAnimatedSkew(skew, emphasized)}
      transition={{ type: "tween", duration: 1.2, ease: CALENDAR_ANIMATION_EASE }}
      transformTemplate={transformTemplate}
      layout={false}
      style={{ transformOrigin: "center center" }}
      className="bg-interactive-border p-0.5 rounded-2xl select-none shadow-xs"
    >
      <CalendarGrid />
    </motion.div>
  );
}

export function MarketingIllustrationCalendar({ children }: PropsWithChildren) {
  return (
    <div className="relative w-full after:absolute after:inset-x-0 after:bottom-0 after:h-1/2 after:bg-linear-to-b after:from-transparent after:to-background">
      <div className="py-12 px-2 max-w-96 mx-auto w-full max-h-64 sm:max-h-72">
        <div className="grid grid-cols-1 grid-rows-1 *:row-start-1 *:col-start-1">
          {children}
        </div>
      </div>
    </div>
  );
}
