import { hueToOklch } from "./color";

export type EventRecord = Record<number, number[]>;

const getEventColorsForDay = (events: EventRecord, day: number): string[] => {
  const colors: string[] = [];
  for (const hue in events) {
    if (events[hue]?.includes(day)) {
      colors.push(hueToOklch(Number(hue)));
    }
  }
  return colors;
};

const getEventColorsForDayIfVisible = (
  events: EventRecord,
  day: number,
  index: number,
  maxIndex: number,
): string[] => {
  if (index > maxIndex) {
    return [];
  }
  return getEventColorsForDay(events, day);
};

const hasEvents = (colors: string[]): boolean => colors.length > 0;

export { getEventColorsForDayIfVisible, hasEvents };
