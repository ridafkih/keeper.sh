"use client";

import type { FC } from "react";
import { motion } from "motion/react";

interface EventIndicatorProps {
  isActive: boolean;
  layoutId: string;
}

const EventIndicator: FC<EventIndicatorProps> = ({ isActive, layoutId }) => {
  if (!isActive) return null;

  return (
    <motion.div
      layoutId={layoutId}
      className="absolute inset-0 bg-neutral-100 rounded-lg"
      transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
    />
  );
};

export { EventIndicator };
