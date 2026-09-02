import { atom } from "jotai";
import type { CalendarEvent } from "@/hooks/use-events";

interface AnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface FrameRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export interface EventDetailSelection {
  event: CalendarEvent;
  /** The clicked card, for focus restore on close. */
  trigger: HTMLElement;
  /** Clicked card's rect, viewport coordinates. */
  anchor: AnchorRect;
  /** Bounds the panel is nudged to stay within. */
  frame: FrameRect;
}

export const eventDetailAtom = atom<EventDetailSelection | null>(null);
