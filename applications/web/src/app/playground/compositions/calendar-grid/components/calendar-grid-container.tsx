"use client";

import type { FC, RefObject } from "react";
import { useRef } from "react";
import { VirtualizerProvider } from "../contexts/calendar-grid-context";
import { useCreateCalendarVirtualizer } from "../hooks/use-calendar-virtualizer";
import { CalendarScrollArea } from "./calendar-scroll-area";
import { CalendarVirtualRows } from "./calendar-virtual-rows";
import { WeekColumn } from "./week-column";

interface CalendarGridContainerProps {
  weekColumnRef: RefObject<HTMLDivElement | null>;
}

const CalendarGridContainer: FC<CalendarGridContainerProps> = ({ weekColumnRef }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useCreateCalendarVirtualizer({ scrollRef, weekColumnRef });
  const virtualRows = virtualizer.getVirtualItems();

  return (
    <VirtualizerProvider virtualizer={virtualizer}>
      <WeekColumn weekColumnRef={weekColumnRef} virtualRows={virtualRows} />
      <div className="absolute inset-0 bg-neutral-300 rounded-2xl p-px overflow-hidden">
        <CalendarScrollArea scrollRef={scrollRef}>
          <CalendarVirtualRows virtualRows={virtualRows} />
        </CalendarScrollArea>
      </div>
    </VirtualizerProvider>
  );
};

export { CalendarGridContainer };
