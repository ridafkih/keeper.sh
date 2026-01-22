import { BentoCard } from "@/components/bento-card"
import type { Feature } from "@/compositions/marketing-features/constants/features"
import type { FC } from "react"

type FeatureCardProps = {
  feature: Feature
}

export const FeatureCard: FC<FeatureCardProps> = ({ feature }) => {
  return (
    <BentoCard
      title={feature.title}
      description={feature.description}
      gridClasses={feature.gridClasses}
    />
  )
}
