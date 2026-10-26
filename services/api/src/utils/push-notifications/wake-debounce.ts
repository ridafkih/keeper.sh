import { resolveWakeDebounceMs } from "@keeper.sh/calendar";
import type { IngestPlan } from "@keeper.sh/calendar";

interface WokenCalendar {
  calendarId: string;
  userId: string;
}

const groupWakesByDebounce = (
  calendars: WokenCalendar[],
  planByUserId: Map<string, IngestPlan>,
): Map<number, string[]> => {
  const groups = new Map<number, string[]>();
  for (const { calendarId, userId } of calendars) {
    const debounceMs = resolveWakeDebounceMs(planByUserId.get(userId) ?? "pro");
    groups.set(debounceMs, [...groups.get(debounceMs) ?? [], calendarId]);
  }
  return groups;
};

export { groupWakesByDebounce };
export type { WokenCalendar };
