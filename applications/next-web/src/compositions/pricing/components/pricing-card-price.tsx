import { MicroCopy } from "@/components/micro-copy"
import { cn } from "@/utils/cn"
import { Lora } from "next/font/google"
import type { FC } from "react"

const lora = Lora()

type PricingCardPriceProps = {
  price: string
}

export const PricingCardPrice: FC<PricingCardPriceProps> = ({ price }) => {
  return (
    <div className="flex items-baseline gap-1">
      <span className={cn(lora.className, "text-3xl font-medium tracking-tighter text-foreground")}>{price}</span>
      <MicroCopy className="text-foreground-subtle">per month</MicroCopy>
    </div>
  )
}
