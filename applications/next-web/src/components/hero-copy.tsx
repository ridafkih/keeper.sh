import type { FC, HTMLProps } from "react"
import { cn } from "@/utils/cn"
import { Copy } from "./copy"

export const HeroCopy: FC<HTMLProps<HTMLParagraphElement>> = ({ className, children, ...props }) => {
  return (
    <Copy {...props} className={cn("text-md max-w-[42ch]", className)}>{children}</Copy>
  )
}
