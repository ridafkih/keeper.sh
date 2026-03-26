import type { ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";

const SWAP_TRANSITION = { duration: 0.24 };
const SWAP_ENTER = { opacity: 1, filter: 'blur(0)', y: 0 };
const SWAP_EXIT = { opacity: 0, filter: 'blur(4px)', /* y: "max(1rem, 25%)" */ };
const SWAP_INITIAL = { opacity: 0, filter: 'blur(4px)', /* y: "calc(max(1rem, 25%) * -1.5)" */ };

interface AnimatedSwapProps {
  swapKey: string;
  children: ReactNode;
}

export function AnimatedSwap({ swapKey, children }: AnimatedSwapProps) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <m.span
        key={swapKey}
        initial={SWAP_INITIAL}
        animate={SWAP_ENTER}
        exit={SWAP_EXIT}
        transition={SWAP_TRANSITION}
        className="inline-flex text-nowrap"
      >
        {children}
      </m.span>
    </AnimatePresence>
  );
}
