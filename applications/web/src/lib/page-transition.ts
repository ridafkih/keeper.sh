import type { Variants } from "motion/react";
import type { SidebarDirection } from "./sidebar-transition";

const NUDGE = 32;

export const PAGE_TRANSITION = { duration: 0.22, ease: [0.2, 0, 0, 1] as const };
export const INSTANT_TRANSITION = { duration: 0 };

export const pageVariants: Variants = {
  enter: (direction: SidebarDirection) => ({ x: direction === "forward" ? NUDGE : -NUDGE, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: SidebarDirection) => ({ x: direction === "forward" ? -NUDGE : NUDGE, opacity: 0 }),
};
