"use client";

import type { FC } from "react";
import { useRef } from "react";
import { CalendarGridProvider } from "./contexts/calendar-grid-context";
import { CalendarGridContainer } from "./components/calendar-grid-container";
import { DayHeaders } from "./components/day-headers";

const CalendarGridContent: FC = () => {
  const monthColumnRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative w-full aspect-square">
        <CalendarGridContainer monthColumnRef={monthColumnRef} />
      </div>
      <DayHeaders />
    </div>
  );
};

const CalendarGrid: FC = () => (
  <CalendarGridProvider>
    <CalendarGridContent />
  </CalendarGridProvider>
);

export { CalendarGrid };
