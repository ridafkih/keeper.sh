import type { FC } from "react";

import { type SkewTuple } from "../utils/transforms";
import { type EventRecord } from "../utils/events";
import { AnimatedCard } from "./animated-card";
import { CalendarFrame } from "./calendar-frame";
import { CalendarGrid } from "./calendar-grid";

interface CalendarProps {
  skew: SkewTuple;
  events: EventRecord;
  className?: string;
}

const Calendar: FC<CalendarProps> = ({ skew, events, className }) => (
  <AnimatedCard skew={skew} className={className}>
    <CalendarFrame>
      <CalendarGrid events={events} />
    </CalendarFrame>
  </AnimatedCard>
);

export { Calendar };
