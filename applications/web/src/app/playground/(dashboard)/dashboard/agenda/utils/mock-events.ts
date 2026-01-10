import type { PlaygroundEvent } from "../../../../compositions/event-list/utils/mock-events";

const createDate = (daysFromToday: number, hours: number, minutes: number = 0): Date => {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  date.setHours(hours, minutes, 0, 0);
  return date;
};

const EVENT_TEMPLATES = [
  { name: "Team Standup", sourceCalendar: "Work", duration: 30 },
  { name: "Design Review", sourceCalendar: "Work", duration: 60 },
  { name: "Lunch", sourceCalendar: "Personal", duration: 60 },
  { name: "Project Planning", sourceCalendar: "Work", duration: 60 },
  { name: "1:1 with Manager", sourceCalendar: "Work", duration: 30 },
  { name: "Gym", sourceCalendar: "Personal", duration: 60 },
  { name: "Coffee Chat", sourceCalendar: "Personal", duration: 45 },
  { name: "Sprint Retro", sourceCalendar: "Work", duration: 60 },
  { name: "Weekly Sync", sourceCalendar: "Work", duration: 60 },
  { name: "Dentist Appointment", sourceCalendar: "Personal", duration: 60 },
  { name: "Code Review", sourceCalendar: "Work", duration: 45 },
  { name: "Team Lunch", sourceCalendar: "Work", duration: 90 },
];

const generateEventsForDay = (dayOffset: number, baseId: number): PlaygroundEvent[] => {
  const eventsPerDay = 3 + Math.floor(Math.random() * 3);
  const events: PlaygroundEvent[] = [];
  const usedHours = new Set<number>();

  for (let i = 0; i < eventsPerDay; i++) {
    const templateIndex = Math.floor(Math.random() * EVENT_TEMPLATES.length);
    const template = EVENT_TEMPLATES[templateIndex]!;
    let startHour: number;

    do {
      startHour = 8 + Math.floor(Math.random() * 10);
    } while (usedHours.has(startHour));

    usedHours.add(startHour);

    const startMinute = Math.random() > 0.5 ? 0 : 30;

    events.push({
      id: `${baseId + i}`,
      name: template.name,
      sourceCalendar: template.sourceCalendar,
      startTime: createDate(dayOffset, startHour, startMinute),
      endTime: createDate(dayOffset, startHour, startMinute + template.duration),
    });
  }

  return events.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
};

const generateWeekEvents = (): PlaygroundEvent[] => {
  const events: PlaygroundEvent[] = [];
  let idCounter = 1;

  for (let day = 0; day < 7; day++) {
    const dayEvents = generateEventsForDay(day, idCounter);
    events.push(...dayEvents);
    idCounter += dayEvents.length;
  }

  return events;
};

const WEEK_EVENTS = generateWeekEvents();

export { WEEK_EVENTS };
