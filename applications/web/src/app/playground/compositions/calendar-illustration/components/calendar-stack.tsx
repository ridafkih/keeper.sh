import type { FC } from "react";

import { createBackLeftSkew, createBackRightSkew, createFrontSkew } from "../utils/stack";
import { type EventRecord } from "../utils/events";
import { Calendar } from "./calendar";

const BACK_LEFT_SKEW = createBackLeftSkew(1);
const BACK_RIGHT_SKEW = createBackRightSkew(1);
const FRONT_SKEW = createFrontSkew(1);

const BACK_LEFT_EVENTS: EventRecord = {
  0: [2, 9, 16, 23],
  30: [5, 12, 19, 26],
  60: [7, 14, 21, 28],
};

const BACK_RIGHT_EVENTS: EventRecord = {
  200: [3, 10, 17, 24],
  230: [6, 13, 20, 27],
  260: [1, 8, 15, 22, 29],
};

const FRONT_EVENTS: EventRecord = {
  250: [1, 2, 3, 4, 7, 8, 27, 28, 29, 30],
  140: [2, 9, 16, 23, 30, 4, 11, 18, 25, 6, 13, 20, 27],
  320: [3, 10, 17, 24, 31, 5, 12, 19, 26],
  11: [1, 8, 15, 22, 29, 2, 9, 16, 23, 30],
};

const CalendarStack: FC = () => (
  <div className="relative grid grid-cols-1 grid-rows-1 *:row-start-1 *:col-start-1">
    <Calendar skew={BACK_LEFT_SKEW} events={BACK_LEFT_EVENTS} />
    <Calendar skew={BACK_RIGHT_SKEW} events={BACK_RIGHT_EVENTS} />
    <Calendar skew={FRONT_SKEW} events={FRONT_EVENTS} className="z-10" />
  </div>
);

export { CalendarStack };
