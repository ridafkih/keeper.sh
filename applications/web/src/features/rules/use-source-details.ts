import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import type { CalendarDetail, CalendarSource } from "@/types/api";
import { canPull } from "@/utils/calendars";
import type { SourceDetails } from "./rules";

const loadDetails = async (ids: string[]): Promise<SourceDetails> => {
  const entries = await Promise.all(ids.map(async (id) => [id, await fetcher<CalendarDetail>(`/api/sources/${id}`)] as const));
  return Object.fromEntries(entries);
};

export function useSourceDetails(sources: CalendarSource[] | undefined) {
  const ids = (sources ?? []).filter(canPull).map((source) => source.id);
  return useSWR<SourceDetails>(
    sources ? ["/api/sources/details", ...ids] : null,
    () => loadDetails(ids),
  );
}
