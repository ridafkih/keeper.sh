"use client";

import type { FC } from "react";
import { useState } from "react";
import { plans } from "@/config/plans";
import { MarketingSection } from "./marketing-section";
import { PricingCard } from "./pricing-card";

interface PricingSectionProps {
  showHeading?: boolean;
}

const getHeading = (showHeading: boolean): string | undefined => {
  if (showHeading) {
    return "Pricing";
  }
  return undefined;
};

export const PricingSection: FC<PricingSectionProps> = ({ showHeading = true }) => {
  const [isYearly, setIsYearly] = useState(true);
  const heading = getHeading(showHeading);

  return (
    <MarketingSection id="pricing" heading={heading}>
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
