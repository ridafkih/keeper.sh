import { hueToOklch } from "./color";

export type EventRecord = Record<number, number[]>;

export const hasEventOnDay = (days: number[], day: number): boolean => days.includes(day);

export const getHuesForDay = (events: EventRecord, day: number): number[] => {
  const hues: number[] = [];
  for (const hue in events) {
    if (events[hue]?.includes(day)) hues.push(Number(hue));
  }
  return hues;
};

export const getEventColorsForDay = (events: EventRecord, day: number): string[] => {
  const colors: string[] = [];
  for (const hue in events) {
    if (events[hue]?.includes(day)) colors.push(hueToOklch(Number(hue)));
  }
  return colors;
};

export const getEventColorsForDayIfVisible = (
  events: EventRecord,
  day: number,
  index: number,
  maxIndex: number
): string[] => {
  if (index > maxIndex) return [];
  return getEventColorsForDay(events, day);
};

export const countEventsOnDay = (events: EventRecord, day: number): number => {
  let count = 0;
  for (const hue in events) {
    if (events[hue]?.includes(day)) count++;
  }
  return count;
};

export const hasEvents = (colors: string[]): boolean => colors.length > 0;

export const getVisibleEventCount = (colors: string[], max: number): number =>
  Math.min(colors.length, max);

export const getOverflowCount = (colors: string[], max: number): number =>
  Math.max(0, colors.length - max);

export const eventRecordToArray = (events: EventRecord) => {
  const result: { hue: number; days: number[] }[] = [];
  for (const hue in events) {
    result.push({ hue: Number(hue), days: events[hue] ?? [] });
  }
  return result;
};

export const groupEventsByDay = (events: EventRecord): Record<number, number[]> => {
  const byDay: Record<number, number[]> = {};
  for (const [hue, days] of Object.entries(events)) {
    for (const day of days) {
      (byDay[day] ??= []).push(Number(hue));
    }
  }
  return byDay;
};
