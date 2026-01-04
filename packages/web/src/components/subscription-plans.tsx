"use client";

import type { FC } from "react";
import { useState } from "react";
import { Toast } from "@/components/toast-provider";
import { PlanCard } from "@/components/plan-card";
import { Section } from "@/components/section";
import { SectionHeader } from "@/components/section-header";
import {
  BillingPeriodToggle,
  type BillingPeriod,
} from "@/components/billing-period-toggle";
import { plans } from "@/config/plans";
import { openCheckout, openCustomerPortal } from "@/utils/checkout";
import { reportPurchaseConversion } from "@/lib/analytics";

interface SubscriptionPlansProps {
  currentPlan?: "free" | "pro";
  currentInterval?: "month" | "year" | "week" | "day" | null;
  isSubscriptionLoading?: boolean;
  onSubscriptionChange: () => void;
}

const deriveBillingPeriod = (
  override: BillingPeriod | null,
  interval: "month" | "year" | "week" | "day" | null | undefined,
): BillingPeriod => {
  if (override) return override;
  return interval === "year" ? "yearly" : "monthly";
};

export const SubscriptionPlans: FC<SubscriptionPlansProps> = ({
  currentPlan,
  currentInterval,
  isSubscriptionLoading,
  onSubscriptionChange,
}) => {
  const toastManager = Toast.useToastManager();
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [billingPeriodOverride, setBillingPeriodOverride] =
    useState<BillingPeriod | null>(null);

  const billingPeriod = deriveBillingPeriod(
    billingPeriodOverride,
    currentInterval,
  );

  const handleUpgrade = async (productId: string) => {
    setIsCheckoutLoading(true);

    try {
      await openCheckout(productId, {
        onSuccess: (data) => {
          reportPurchaseConversion({
            value: data.totalAmount ? data.totalAmount / 100 : undefined,
            currency: data.currency,
            transactionId: data.id,
          });
          toastManager.add({ title: "Subscription updated successfully" });
          onSubscriptionChange();
        },
      });
    } catch {
      toastManager.add({ title: "Failed to open checkout" });
    } finally {
      setIsCheckoutLoading(false);
    }
  };

  const handleManage = async () => {
    try {
      await openCustomerPortal();
    } catch {
      toastManager.add({ title: "Failed to open customer portal" });
    }
  };

  const isYearly = billingPeriod === "yearly";
  const isCurrentInterval =
    (currentInterval === "year" && billingPeriod === "yearly") ||
    (currentInterval === "month" && billingPeriod === "monthly");

  return (
    <Section>
      <SectionHeader
        title="Subscription Plan"
        description="Manage your subscription and billing details"
      />

      <BillingPeriodToggle
        value={billingPeriod}
        onChange={setBillingPeriodOverride}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-3xl">
        {plans.map((plan) => {
          const productId = isYearly
            ? plan.yearlyProductId
            : plan.monthlyProductId;

          const periodText = isYearly ? " per year" : " per month";
          const showPeriodText = plan.monthlyPrice > 0;

          return (
            <PlanCard
              key={plan.id}
              plan={{
                ...plan,
                price: isYearly ? plan.yearlyPrice : plan.monthlyPrice,
                period: showPeriodText ? periodText : "",
              }}
              isCurrent={currentPlan === plan.id}
              isCurrentInterval={isCurrentInterval}
              isLoading={isCheckoutLoading}
              isSubscriptionLoading={isSubscriptionLoading}
              onUpgrade={() => productId && handleUpgrade(productId)}
              onManage={handleManage}
              onSwitchInterval={handleManage}
              targetInterval={billingPeriod}
            />
          );
        })}
      </div>
    </Section>
  );
};
