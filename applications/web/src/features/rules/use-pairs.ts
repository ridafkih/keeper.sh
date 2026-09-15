import { useCallback, useMemo } from "react";
import useSWR from "swr";
import type { CalendarSource } from "@/types/api";
import { buildPairGroups, type PairGroup } from "./rules";
import { useSourceDetails } from "./use-source-details";

export function usePairs() {
  const sources = useSWR<CalendarSource[]>("/api/sources");
  const details = useSourceDetails(sources.data);
  const sourceList = sources.data;
  const detailMap = details.data;

  const groups = useMemo<PairGroup[] | null>(
    () => (sourceList && detailMap ? buildPairGroups(sourceList, detailMap) : null),
    [sourceList, detailMap],
  );

  const mutateSources = sources.mutate;
  const mutateDetails = details.mutate;
  const mutate = useCallback(() => Promise.all([mutateSources(), mutateDetails()]), [mutateSources, mutateDetails]);

  return { error: sources.error ?? details.error, groups, mutate, sources: sourceList };
}
