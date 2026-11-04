import { EVENT_GRAPH_TOTAL_DAYS, resolveGraphSlotIndex } from "@/state/event-graph-hover";
import { resolveEventStartDay } from "@/lib/event-day";
import type { ApiEventSummary } from "@/types/api";

const MS_PER_DAY = 86_400_000;

export const countEventsByDay = (events: ApiEventSummary[], todayStart: Date): number[] => {
  const counts = new Array<number>(EVENT_GRAPH_TOTAL_DAYS).fill(0);
  for (const event of events) {
    const eventDay = resolveEventStartDay({ startTime: new Date(event.startTime), isAllDay: event.isAllDay });
    const slotIndex = resolveGraphSlotIndex(Math.round((eventDay.getTime() - todayStart.getTime()) / MS_PER_DAY));
    if (slotIndex !== null) counts[slotIndex]++;
  }
  return counts;
};
