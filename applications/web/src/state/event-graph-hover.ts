import { atom } from "jotai";

export const EVENT_GRAPH_DAYS_BEFORE = 7;
export const EVENT_GRAPH_DAYS_AFTER = 7;
export const EVENT_GRAPH_TOTAL_DAYS = EVENT_GRAPH_DAYS_BEFORE + 1 + EVENT_GRAPH_DAYS_AFTER;

export const eventGraphHoverIndexAtom = atom<number | null>(null);

export function resolveGraphSlotIndex(dayOffset: number): number | null {
  if (dayOffset < -EVENT_GRAPH_DAYS_BEFORE || dayOffset > EVENT_GRAPH_DAYS_AFTER) return null;
  return dayOffset + EVENT_GRAPH_DAYS_BEFORE;
}

export const eventGraphPointerAtom = atom(false);

export const calendarHighlightSlotAtom = atom((get) =>
  get(eventGraphPointerAtom) ? get(eventGraphHoverIndexAtom) : null,
);

export const calendarJumpAtom = atom<{ dayMs: number } | null>(null);
