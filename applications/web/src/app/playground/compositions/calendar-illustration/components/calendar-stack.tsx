import { FC } from "react";

import { createBackLeftSkew, createBackRightSkew, createFrontSkew } from "../utils/stack";
import { Calendar } from "./calendar";

type CalendarStackProps = {
  emphasized?: boolean;
};

export const CalendarStack: FC<CalendarStackProps> = ({ emphasized }) => (
  <div className="relative grid grid-cols-1 grid-rows-1 *:row-start-1 *:col-start-1">
    <Calendar
      skew={createBackLeftSkew(1)}
      events={{
        0: [2, 9, 16, 23],
        30: [5, 12, 19, 26],
        60: [7, 14, 21, 28],
      }}
      emphasized={emphasized}
    />
    <Calendar
      skew={createBackRightSkew(1)}
      events={{
        200: [3, 10, 17, 24],
        230: [6, 13, 20, 27],
        260: [1, 8, 15, 22, 29],
      }}
      emphasized={emphasized}
    />
    <Calendar
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
