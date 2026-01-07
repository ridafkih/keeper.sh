"use client";

import { FC } from "react";
import { motion } from "motion/react";

import { createBackLeftSkew, createBackRightSkew, createFrontSkew } from "../utils/stack";
import { AnimatedCard } from "./animated-card";
import { CalendarFrame } from "./calendar-frame";
import { CalendarGrid } from "./calendar-grid";
import { SkewTuple, EventRecord } from "../calendar-illustration";

type LandingPageIllustrativeCalendarProps = {
  skew: SkewTuple;
  events: EventRecord;
  emphasized?: boolean;
  className?: string;
};

export const LandingPageIllustrativeCalendar: FC<LandingPageIllustrativeCalendarProps> = ({
  skew,
  events,
  emphasized,
  className,
}) => (
  <AnimatedCard skew={skew} emphasized={emphasized} className={className}>
    <CalendarFrame>
      <CalendarGrid events={events} />
    </CalendarFrame>
  </AnimatedCard>
);

type CalendarStackProps = {
  emphasized?: boolean;
};

export const LandingPageIllustrativeCalendarStack: FC<CalendarStackProps> = ({ emphasized }) => (
  <div className="py-4 relative grid grid-cols-1 grid-rows-1 *:row-start-1 *:col-start-1">
    <LandingPageIllustrativeCalendar
      skew={createBackLeftSkew(1)}
      events={{
        0: [2, 9, 16, 23],
        30: [5, 12, 19, 26],
        60: [7, 14, 21, 28],
      }}
      emphasized={emphasized}
    />
    <LandingPageIllustrativeCalendar
      skew={createBackRightSkew(1)}
      events={{
        200: [3, 10, 17, 24],
        230: [6, 13, 20, 27],
        260: [1, 8, 15, 22, 29],
      }}
      emphasized={emphasized}
    />
    <LandingPageIllustrativeCalendar
      skew={createFrontSkew(1)}
      events={{
        250: [1, 2, 3, 4, 7, 8, 27, 28, 29, 30],
        140: [2, 9, 16, 23, 30, 4, 11, 18, 25, 6, 13, 20, 27],
        320: [3, 10, 17, 24, 31, 5, 12, 19, 26],
        11: [1, 8, 15, 22, 29, 2, 9, 16, 23, 30],
      }}
      emphasized={emphasized}
      className="z-10"
    />
  </div>
);
