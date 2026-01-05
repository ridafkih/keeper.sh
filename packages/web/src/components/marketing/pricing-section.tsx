"use client";

import type { FC } from "react";
import { useState } from "react";
import { plans } from "@/config/plans";
import { MarketingSection } from "./marketing-section";
import { PricingCard } from "./pricing-card";

interface PricingSectionProps {
  showHeading?: boolean;
}

export const PricingSection: FC<PricingSectionProps> = ({ showHeading = true }) => {
  const [isYearly, setIsYearly] = useState(true);

  return (
    <MarketingSection id="pricing" heading={showHeading ? "Pricing" : undefined}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {plans.map((plan) => (
          <PricingCard
            key={plan.id}
            plan={plan}
            isYearly={isYearly}
            onBillingChange={setIsYearly}
          />
        ))}
      </div>
    </MarketingSection>
  );
};
