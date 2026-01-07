"use client";

import type { FC, ReactNode } from "react";
import { motion } from "motion/react";
import { clsx } from "clsx";

import {
  type SkewTuple,
  getTransitionConfig,
  selectSkewByState,
  getInitialSkew,
} from "../utils/transforms";

interface AnimatedCardProps {
  skew: SkewTuple;
  emphasized?: boolean;
  className?: string;
  children: ReactNode;
}

export const AnimatedCard: FC<AnimatedCardProps> = ({
  skew,
  emphasized = false,
  className,
  children,
}) => (
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
