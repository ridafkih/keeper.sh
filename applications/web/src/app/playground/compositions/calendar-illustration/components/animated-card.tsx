"use client";

import type { FC, PropsWithChildren } from "react";
import { motion } from "motion/react";
import { clsx } from "clsx";

import {
  type SkewTuple,
  getTransitionConfig,
  selectSkewByState,
  getInitialSkew,
} from "../utils/transforms";
import { useSyncHoverState } from "../contexts/sync-hover-context";

interface AnimatedCardProps {
  skew: SkewTuple;
  className?: string;
}

const AnimatedCard: FC<PropsWithChildren<AnimatedCardProps>> = ({ skew, className, children }) => {
  const emphasized = useSyncHoverState();

  return (
    <motion.div
      initial={getInitialSkew(skew)}
      animate={selectSkewByState(skew, emphasized)}
      transition={getTransitionConfig(1.2)}
      className={clsx(
        "shadow-[0_2px_1px_1px_rgba(0,0,0,0.025)] rounded-[0.875rem] overflow-hidden",
        className,
      )}
    >
      {children}
    </motion.div>
  );
};

export { AnimatedCard };
