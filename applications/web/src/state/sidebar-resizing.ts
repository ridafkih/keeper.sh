import { atom } from "jotai";

// True while the sidebar's width tweens, so the calendar can suspend scroll snapping mid-resize.
export const sidebarResizingAtom = atom(false);
