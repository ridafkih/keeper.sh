import { Heading3 } from "@/components/heading"
import { MicroCopy } from "@/components/micro-copy"
import { Copy } from "@/components/copy"
import { LinkButton } from "@/components/button"
import { FlexColumnGroup } from "@/components/flex-column-group"
import { PricingCardPrice } from "@/compositions/pricing/components/pricing-card-price"
import { tv } from "tailwind-variants"
import type { FC } from "react"
import type { PricingPlan } from "@/compositions/pricing/constants/plans"

const pricingCard = tv({
  base: "border border-border rounded-2xl p-3 pt-5 flex flex-col shadow-xs",
  variants: {
    highlighted: {
      true: "bg-background invert"
    }
  }
})

type PricingCardProps = {
  plan: PricingPlan
}

export const PricingCard: FC<PricingCardProps> = ({ plan }) => {
  return (
    <div className={pricingCard({ highlighted: plan.highlighted })}>
      <FlexColumnGroup className="px-2">
        <FlexColumnGroup>
          <Heading3>{plan.name}</Heading3>
          <FlexColumnGroup className="gap-1">
            <PricingCardPrice price={plan.price} />
            {plan.priceNote && <MicroCopy className="text-foreground-subtle">{plan.priceNote}</MicroCopy>}
          </FlexColumnGroup>
        </FlexColumnGroup>
        <Copy className="py-4">{plan.description}</Copy>
      </FlexColumnGroup>

      <LinkButton
        href={plan.buttonHref}
        variant={plan.highlighted ? "primary" : "border"}
        className="w-full justify-center mt-auto"
      >
        {plan.buttonText}
      </LinkButton>
    </div>
  )
}
