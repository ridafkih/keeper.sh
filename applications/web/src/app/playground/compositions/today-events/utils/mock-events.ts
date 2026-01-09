interface PlaygroundEvent {
  id: string;
  name: string;
  sourceCalendar: string;
  startTime: Date;
  endTime: Date;
}

const createTodayDate = (hours: number, minutes: number = 0): Date => {
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
};

const MOCK_EVENTS: PlaygroundEvent[] = [
  {
    id: "1",
    name: "Team Standup",
    sourceCalendar: "Work",
    startTime: createTodayDate(9, 0),
    endTime: createTodayDate(9, 30),
  },
  {
    id: "2",
    name: "Design Review",
    sourceCalendar: "Work",
    startTime: createTodayDate(11, 0),
    endTime: createTodayDate(12, 0),
  },
  {
    id: "3",
    name: "Lunch with Sarah",
    sourceCalendar: "Personal",
    startTime: createTodayDate(12, 30),
    endTime: createTodayDate(13, 30),
  },
  {
    id: "4",
    name: "Project Planning",
    sourceCalendar: "Work",
    startTime: createTodayDate(14, 0),
    endTime: createTodayDate(15, 0),
  },
  {
    id: "5",
    name: "Gym",
    sourceCalendar: "Personal",
    startTime: createTodayDate(18, 0),
    endTime: createTodayDate(19, 0),
  },
];

export type { PlaygroundEvent };
export { MOCK_EVENTS };
