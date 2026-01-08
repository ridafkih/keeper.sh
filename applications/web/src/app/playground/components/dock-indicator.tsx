"use client";

import { motion } from "motion/react";
import { useSelectedLayoutSegment } from "next/navigation";
import type { FC } from "react";

interface DockIndicatorProps {
  segment: string | null;
}

const DockIndicator: FC<DockIndicatorProps> = ({ segment }) => {
  const selectedSegment = useSelectedLayoutSegment();

  console.log({ selectedSegment })

  if (selectedSegment !== segment) {
    return null;
  }

  return (
    <motion.div
      layout
      layoutId="indicator"
      style={{ originY: "top" }}
      transition={{ duration: 0.16, ease: [0.5, 0, 0, 1] }}
      className="absolute inset-0 size-full rounded-full z-10 bg-linear-to-b from-neutral-700 to-neutral-800 border-y border-t-neutral-500 border-b-neutral-600"
    />
  );
};

export { DockIndicator };
