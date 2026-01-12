import { createDate } from "../../../utils/date-helpers";

interface PlaygroundEvent {
  id: string;
  name: string;
  sourceCalendar: string;
  startTime: Date;
  endTime: Date;
}

const TODAY_EVENTS: PlaygroundEvent[] = [
  {
    id: "1",
    name: "Team Standup",
    sourceCalendar: "Work",
    startTime: createDate(0, 9, 0),
    endTime: createDate(0, 9, 30),
  },
  {
    id: "2",
    name: "Design Review",
    sourceCalendar: "Work",
    startTime: createDate(0, 11, 0),
    endTime: createDate(0, 12, 0),
  },
  {
    id: "3",
    name: "Lunch with Sarah",
    sourceCalendar: "Personal",
    startTime: createDate(0, 12, 30),
    endTime: createDate(0, 13, 30),
  },
  {
    id: "4",
    name: "Project Planning",
    sourceCalendar: "Work",
    startTime: createDate(0, 14, 0),
    endTime: createDate(0, 15, 0),
  },
  {
    id: "5",
    name: "Gym",
    sourceCalendar: "Personal",
    startTime: createDate(0, 18, 0),
    endTime: createDate(0, 19, 0),
  },
];

const TOMORROW_EVENTS: PlaygroundEvent[] = [
  {
    id: "6",
    name: "Weekly Sync",
    sourceCalendar: "Work",
    startTime: createDate(1, 10, 0),
    endTime: createDate(1, 11, 0),
  },
  {
    id: "7",
    name: "Coffee with Alex",
    sourceCalendar: "Personal",
    startTime: createDate(1, 14, 0),
    endTime: createDate(1, 15, 0),
  },
  {
    id: "8",
    name: "Sprint Retro",
    sourceCalendar: "Work",
    startTime: createDate(1, 16, 0),
    endTime: createDate(1, 17, 0),
  },
];

export type { PlaygroundEvent };
export { TODAY_EVENTS, TOMORROW_EVENTS };
