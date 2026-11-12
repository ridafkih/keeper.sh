import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";

interface CopiedEvent {
  id: string;
  title: string | null;
  startTime: string;
  sourceCalendarId: string | null;
  destinationCalendarId: string;
}

interface CopiedEvents {
  count: number;
  upcoming: CopiedEvent[];
}

const COPIES_PATH = "/api/sync/copies";

export function useCopiedEvents(enabled: boolean, serverStateVersion: string) {
  const { data } = useSWR<CopiedEvents>(
    enabled ? [COPIES_PATH, serverStateVersion] : null,
    () => fetcher<CopiedEvents>(COPIES_PATH),
    { keepPreviousData: true },
  );
  return data ?? null;
}

export type { CopiedEvent, CopiedEvents };
