"use client";

import type { FC } from "react";
import type { VirtualItem } from "@tanstack/react-virtual";
import { useRowHeight } from "../contexts/calendar-grid-context";

interface WeekColumnProps {
  weekColumnRef: React.RefObject<HTMLDivElement | null>;
  virtualRows: VirtualItem[];
}

const WeekColumn: FC<WeekColumnProps> = ({ weekColumnRef, virtualRows }) => {
  const rowHeight = useRowHeight();

  return (
    <div className="absolute -left-7 top-0 bottom-0 min-w-6 overflow-hidden">
      <div ref={weekColumnRef} className="absolute inset-x-0">
        {virtualRows.map((virtualRow) => {
          const weekNumber = (virtualRow.index + 1).toString().padStart(2, "0");

          return (
            <div
              key={virtualRow.key}
              className="absolute left-0 right-0"
              style={{
                height: `${rowHeight}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div className="absolute -top-px left-1/2 h-[calc(50%+1px)] w-px -translate-x-1/2 bg-neutral-300" />
              <div className="absolute top-1/2 left-1/2 h-[calc(50%+1px)] w-px -translate-x-1/2 bg-neutral-300" />
              <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 font-mono text-[10px] text-neutral-400 leading-none px-1 py-0.5 bg-neutral-50 rounded-xl">
                {weekNumber}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export { WeekColumn };
