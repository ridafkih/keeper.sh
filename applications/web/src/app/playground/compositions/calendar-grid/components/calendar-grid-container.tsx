"use client";

import type { FC, RefObject } from "react";
import { useRef } from "react";
import { VirtualizerProvider } from "../contexts/calendar-grid-context";
import { useCreateCalendarVirtualizer } from "../hooks/use-calendar-virtualizer";
import { CalendarScrollArea } from "./calendar-scroll-area";
import { CalendarVirtualRows } from "./calendar-virtual-rows";
import { MonthColumn } from "./month-column";

interface CalendarGridContainerProps {
  monthColumnRef: RefObject<HTMLDivElement | null>;
}

const CalendarGridContainer: FC<CalendarGridContainerProps> = ({ monthColumnRef }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useCreateCalendarVirtualizer({ scrollRef, monthColumnRef });
  const virtualRows = virtualizer.getVirtualItems();

  return (
    <VirtualizerProvider virtualizer={virtualizer}>
      <MonthColumn monthColumnRef={monthColumnRef} virtualRows={virtualRows} />
      <div className="absolute inset-0 bg-neutral-300 rounded-2xl p-px overflow-hidden">
        <CalendarScrollArea scrollRef={scrollRef}>
          <CalendarVirtualRows virtualRows={virtualRows} />
        </CalendarScrollArea>
      </div>
    </VirtualizerProvider>
  );
};

export { CalendarGridContainer };
