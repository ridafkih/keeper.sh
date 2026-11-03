import useSWR from "swr";
import type { CalendarSource } from "@/types/api";
import { describeSyncPairs } from "./sync-pairs";
import type { MappingPair, SyncPairSummary } from "./sync-pairs";

interface SyncPairWithSource {
  pair: SyncPairSummary;
  source: CalendarSource;
}

export function useSyncPairs(calendars: CalendarSource[] | undefined): SyncPairWithSource[] {
  const { data } = useSWR<{ mappings: MappingPair[] }>("/api/mappings");
  if (!data || !calendars) return [];

  const calendarsById = new Map(calendars.map((calendar) => [calendar.id, calendar]));
  const names = new Map(calendars.map(({ id, name }) => [id, name]));

  return describeSyncPairs(data.mappings, names).flatMap((pair) => {
    const source = calendarsById.get(pair.sourceCalendarId);
    if (!source) return [];
    return [{ pair, source }];
  });
}
