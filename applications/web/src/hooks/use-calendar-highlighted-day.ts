import { useMemo } from "react";
import { atom, useAtomValue } from "jotai";
import { calendarHighlightSlotAtom, resolveGraphSlotIndex } from "@/state/event-graph-hover";

export function useCalendarHighlightedDay(dayOffset: number): boolean {
  const isHighlightedAtom = useMemo(() => {
    const slot = resolveGraphSlotIndex(dayOffset);
    return atom((get) => slot !== null && get(calendarHighlightSlotAtom) === slot);
  }, [dayOffset]);
  return useAtomValue(isHighlightedAtom);
}
