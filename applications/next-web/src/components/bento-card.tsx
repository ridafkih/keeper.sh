import { BentoCardPlaceholder } from "@/components/bento-card-placeholder"
import { Copy } from "@/components/copy"
import { Heading3 } from "@/components/heading"
import { cn } from "@/utils/cn"
import type { FC } from "react"

type BentoCardProps = {
  title: string
  description: string
  gridClasses?: string
}

export const BentoCard: FC<BentoCardProps> = ({ title, description, gridClasses }) => {
  return (
    <div className={cn("flex flex-col h-full", gridClasses)}>
      <BentoCardPlaceholder />
      <div className="flex flex-col gap-2 p-4">
        <Heading3>{title}</Heading3>
        <Copy>{description}</Copy>
      </div>
    </div>
  )
}
