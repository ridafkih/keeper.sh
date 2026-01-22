"use client"

import type { FC, PropsWithChildren } from "react"
import { useAtomValue } from "jotai"
import { motion } from "motion/react"
import { cn } from "@/utils/cn"
import { type SkewTuple, getTransitionConfig, selectSkewByState, getInitialSkew } from "../utils/transforms"
import { calendarHoverAtom } from "../state/calendar-hover"

type AnimatedCardProps = PropsWithChildren<{
  skew: SkewTuple
  className?: string
}>

export const AnimatedCard: FC<AnimatedCardProps> = ({ skew, className, children }) => {
  const emphasized = useAtomValue(calendarHoverAtom)

  return (
    <motion.div
      initial={getInitialSkew(skew)}
      animate={selectSkewByState(skew, emphasized)}
      transition={getTransitionConfig(1.2)}
      className={cn(
        "shadow-[0_2px_1px_1px_rgba(0,0,0,0.025)] rounded-[0.875rem] overflow-hidden",
        className
      )}
    >
      {children}
    </motion.div>
  )
}
