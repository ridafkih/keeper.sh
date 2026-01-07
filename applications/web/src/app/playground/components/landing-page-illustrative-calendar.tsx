"use client";

import { FC } from "react";
import { motion } from "motion/react";
import clsx from "clsx";

type Skew = { rotate: number; x: number; y: number };

type CalendarGridProps = {
  skew: [Skew, Skew];
  events: Record<number, number[]>;
  className?: string;
};

const hueToColor = (hue: number): string => `oklch(0.75 0.15 ${hue})`;

const getEventColors = (events: Record<number, number[]>, day: number): string[] => {
  const colors: string[] = [];
  for (const [hue, days] of Object.entries(events)) {
    if (days.includes(day)) colors.push(hueToColor(Number(hue)));
  }
  return colors;
};

export const LandingPageIllustrativeCalendar: FC<CalendarGridProps> = ({ skew, events, className }) => {
  const [initial, animate] = skew;

  return (
    <motion.div
      initial={initial}
      animate={animate}
      transition={{ duration: 1.2, ease: [0.16, 0.85, 0.2, 1] }}
      className={clsx("shadow-lg rounded-[0.875rem] overflow-hidden", className)}
    >
      <div className="p-0.5 bg-neutral-200">
        <div className="grid grid-cols-7 gap-0.5 overflow-hidden rounded-xl">
          {[...Array(7 * 5)].map((_, index) => {
            const dayNumber = (index % 31) + 1;
            const dayEvents = index <= 30 ? getEventColors(events, dayNumber) : [];

            return (
              <div
                key={index.toString()}
                className="relative overflow-hidden aspect-square bg-neutral-50 p-1.5 flex flex-col"
              >
                <div className="text-[0.625rem] text-neutral-500 text-center font-semibold">
                  {dayNumber.toString()}
                </div>
                {dayEvents.length > 0 && (
                  <div className="flex justify-center gap-0.5 mt-auto">
                    {dayEvents.map((color) => (
                      <div
                        key={color}
                        className="size-1.5 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
};

export const LandingPageIllustrativeCalendarStack = () => {
  return (
    <div className="relative grid grid-cols-1 grid-rows-1 *:row-start-1 *:col-start-1">
      <LandingPageIllustrativeCalendar
        skew={[{ rotate: -12, x: -24, y: 12 }, { rotate: -6, x: -16, y: 8 }]}
        events={{
          0: [2, 9, 16, 23],
          30: [5, 12, 19, 26],
          60: [7, 14, 21, 28],
        }}
      />
      <LandingPageIllustrativeCalendar
        skew={[{ rotate: 9, x: 20, y: -8 }, { rotate: 3, x: 12, y: -4 }]}
        events={{
          200: [3, 10, 17, 24],
          230: [6, 13, 20, 27],
          260: [1, 8, 15, 22, 29],
        }}
      />
      <LandingPageIllustrativeCalendar
        skew={[{ rotate: 2, x: 0, y: -4 }, { rotate: 0, x: 0, y: 0 }]}
        events={{
          250: [1, 2, 3, 4, 7, 8, 27, 28, 29, 30],
          140: [2, 9, 16, 23, 30, 4, 11, 18, 25, 6, 13, 20, 27],
          320: [3, 10, 17, 24, 31, 5, 12, 19, 26],
          11: [1, 8, 15, 22, 29, 2, 9, 16, 23, 30],
        }}
        className="z-10"
      />
    </div>
  );
};
