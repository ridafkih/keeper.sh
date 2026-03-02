import { useAtomValue } from "jotai";
import { motion } from "motion/react";
import type { TargetAndTransition } from "motion/react";
import type { PropsWithChildren } from "react";
import { calendarEmphasizedAtom } from "../../state/calendar-emphasized";

export interface Skew extends TargetAndTransition {
  rotate: number;
  x: number;
  y: number;
}

export type SkewTuple = [Skew, Skew, Skew];

const MAGIC_CALENDAR_COLUMNS = 7;
const MAGIC_CALENDAR_ROWS = 6;
const MAGIC_CALENDAR_DAYS_IN_MONTH = 31;
const MAGIC_CALENDAR_CELLS = MAGIC_CALENDAR_COLUMNS * MAGIC_CALENDAR_ROWS;
const MAGIC_ANIMATION_DURATION = 1.2;
const MAGIC_ANIMATION_EASING = [0.16, 0.85, 0.2, 1] as const;

const getInitialSkew = (skew: SkewTuple) => skew[0];
const selectSkewByState = (skew: SkewTuple, emphasized: boolean) =>
  emphasized ? skew[2] : skew[1];

const transition = { duration: MAGIC_ANIMATION_DURATION, ease: MAGIC_ANIMATION_EASING };

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

function CalendarGrid() {
  return (
    <div
      className="grid grid-cols-7 rounded-[0.875rem] gap-0.5 overflow-hidden"
      style={{ gridTemplateColumns: `repeat(${MAGIC_CALENDAR_COLUMNS}, minmax(0, 1fr))` }}
    >
      {[...Array(MAGIC_CALENDAR_CELLS)].map((_, index) => (
        <CalendarDay key={index} day={(index % MAGIC_CALENDAR_DAYS_IN_MONTH) + 1} />
      ))}
    </div>
  );
}

function CalendarDay({ day }: { day: number }) {
  return (
    <div className="bg-background aspect-square flex justify-center py-2 text-[0.625rem] text-foreground-muted">
      {day}
    </div>
  );
}

export function MarketingIllustrationCalendarCard({ skew }: { skew: SkewTuple }) {
  const emphasized = useAtomValue(calendarEmphasizedAtom);

  return (
    <motion.div
      initial={getInitialSkew(skew)}
      animate={selectSkewByState(skew, emphasized)}
      transition={transition}
      className="bg-interactive-border p-0.5 rounded-2xl select-none shadow-xs"
    >
      <CalendarGrid />
    </motion.div>
  );
}
