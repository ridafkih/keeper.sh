"use client";

import type { FC } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useFirstVisibleRowIndex, useScrollDirection } from "../contexts/calendar-grid-context";
import { getStartDate, getRowDates, groupDatesByMonth } from "../utils/date-utils";
import { MONTH_NAMES, COLUMN_COUNT } from "../utils/constants";

const startDate = getStartDate();

const MonthRow: FC = () => {
  const firstVisibleRowIndex = useFirstVisibleRowIndex();
  const scrollDirection = useScrollDirection();
  const rowDates = getRowDates(startDate, firstVisibleRowIndex);
  const monthSpans = groupDatesByMonth(rowDates);

  const yOffset = scrollDirection === "down" ? 16 : -16;

  return (
    <div className="relative h-4 overflow-hidden">
      <div className="absolute top-1/2 left-0 right-0 h-px -translate-y-1/2 bg-neutral-300" />
      <AnimatePresence mode="popLayout" initial={false}>
        {monthSpans.map((span) => {
          const centerCol = (span.startCol + span.endCol) / 2;
          const leftPercent = ((centerCol + 0.5) / COLUMN_COUNT) * 100;
          const label = `${MONTH_NAMES[span.month]!.toUpperCase()}${span.year.toString().slice(-2)}`;

          return (
            <motion.span
              key={`${span.month}-${span.year}-${firstVisibleRowIndex}`}
              initial={{ y: yOffset, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -yOffset, opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${leftPercent}%` }}
            >
              <span className="block font-mono text-[10px] text-neutral-400 leading-none px-1 bg-neutral-50 rounded-full whitespace-nowrap">
                {label}
              </span>
            </motion.span>
          );
        })}
      </AnimatePresence>
    </div>
  );
};

export { MonthRow };
