import { BentoGrid } from "@/components/bento-grid"
import { FeatureCard } from "@/compositions/marketing-features/components/feature-card"
import { features } from "@/compositions/marketing-features/constants/features"
import type { FC } from "react"

export const MarketingFeatures: FC = () => {
  return (
    <section className="px-4 md:px-8 w-full bg-background relative z-30">
      <BentoGrid className="max-w-3xl mx-auto">
        {features.map((feature) => (
          <FeatureCard key={feature.id} feature={feature} />
        ))}
      </BentoGrid>
    </section>
  )
}
