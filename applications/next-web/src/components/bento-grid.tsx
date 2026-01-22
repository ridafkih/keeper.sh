import { cn } from "@/utils/cn"
import type { FC, PropsWithChildren } from "react"

type BentoGridProps = PropsWithChildren<{
  className?: string
}>

export const BentoGrid: FC<BentoGridProps> = ({ children, className }) => {
  return (
    <div className={cn("grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-10 border border-border rounded-2xl overflow-hidden", className)}>
      {children}
    </div>
  )
}
