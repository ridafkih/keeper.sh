import type { FC, HTMLProps } from "react"
import { cn } from "@/utils/cn"
import { Heading1 } from "./heading"

export const HeroTitle: FC<HTMLProps<HTMLHeadingElement>> = ({ className, children, ...props }) => {
  return (
    <Heading1 {...props} className={cn("text-3xl", className)}>{children}</Heading1>
  )
}
