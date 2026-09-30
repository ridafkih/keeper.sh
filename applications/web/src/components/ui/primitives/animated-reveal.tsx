import { AnimatePresence, LazyMotion } from "motion/react";
import { loadMotionFeatures } from "@/lib/motion-features";
import * as m from "motion/react-m";
import type { ReactNode } from "react";

// Clipping and the filter only last as long as the animation: left on, they'd cut off and bury popovers inside.
const HIDDEN = { height: 0, opacity: 0, filter: "blur(4px)", overflow: "clip" };
const VISIBLE = { height: "fit-content", opacity: 1, filter: "blur(0px)", transitionEnd: { filter: "none", overflow: "visible" } };
const LEAVING = { ...HIDDEN, filter: ["blur(0px)", "blur(4px)"] };
const CLIP_STYLE = { overflowClipMargin: 4 };

interface AnimatedRevealProps {
  show: boolean;
  skipInitial?: boolean;
  children: ReactNode;
}

export function AnimatedReveal({ show, skipInitial, children }: AnimatedRevealProps) {
  return (
    <LazyMotion features={loadMotionFeatures}>
      <AnimatePresence initial={!skipInitial}>
        {show && <RevealItem>{children}</RevealItem>}
      </AnimatePresence>
    </LazyMotion>
  );
}

// For a keyed list: only items added or removed after mount animate.
export function RevealGroup({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadMotionFeatures}>
      <AnimatePresence initial={false}>{children}</AnimatePresence>
    </LazyMotion>
  );
}

export function RevealItem({ children }: { children: ReactNode }) {
  return (
    <m.div style={CLIP_STYLE} initial={HIDDEN} animate={VISIBLE} exit={LEAVING}>
      {children}
    </m.div>
  );
}
