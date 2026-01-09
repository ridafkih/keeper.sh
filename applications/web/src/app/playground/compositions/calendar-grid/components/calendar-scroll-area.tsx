"use client";

import type { FC, PropsWithChildren, RefObject } from "react";
import { useRowHeightSync } from "../hooks/use-row-height-sync";

interface CalendarScrollAreaProps {
  scrollRef: RefObject<HTMLDivElement | null>;
}

const CalendarScrollArea: FC<PropsWithChildren<CalendarScrollAreaProps>> = ({
  scrollRef,
  children,
}) => {
  useRowHeightSync(scrollRef);

  return (
    <div
      ref={scrollRef}
      className="size-full overflow-auto bg-neutral-300 rounded-[0.9375rem]"
    >
      {children}
    </div>
  );
};

export { CalendarScrollArea };
