import { atom } from "jotai";

export const eventGraphHoverIndexAtom = atom<number | null>(null);
export const eventGraphDraggingAtom = atom(false);
