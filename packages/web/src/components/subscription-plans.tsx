"use client";

import { useState } from "react";
import { Toast } from "@/components/toast-provider";
import { PlanCard } from "@/components/plan-card";
import {
  BillingPeriodToggle,
  type BillingPeriod,
} from "@/components/billing-period-toggle";
import { plans } from "@/config/plans";
import { openCheckout, openCustomerPortal } from "@/utils/checkout";

interface SubscriptionPlansProps {
  currentPlan?: "free" | "pro";
  currentInterval?: "month" | "year" | "week" | "day" | null;
  isSubscriptionLoading?: boolean;
  onSubscriptionChange: () => void;
}

export function SubscriptionPlans({
  currentPlan,
  currentInterval,
  isSubscriptionLoading,
  onSubscriptionChange,
}: SubscriptionPlansProps) {
  const toastManager = Toast.useToastManager();
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [billingPeriodOverride, setBillingPeriodOverride] = useState<BillingPeriod | null>(null);

  const billingPeriod = billingPeriodOverride ?? (currentInterval === "year" ? "yearly" : "monthly");

  const handleUpgrade = async (productId: string) => {
    setIsCheckoutLoading(true);

    try {
      await openCheckout(productId, {
        onSuccess: () => {
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
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">
          Subscription Plan
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Manage your subscription and billing details
        </p>
      </div>

      <div className="flex items-center gap-3">
        <BillingPeriodToggle value={billingPeriod} onChange={setBillingPeriodOverride} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
        {plans.map((plan) => {
          const productId = isYearly
            ? plan.yearlyProductId
            : plan.monthlyProductId;

          return (
            <PlanCard
              key={plan.id}
              plan={{
                ...plan,
                price: isYearly ? plan.yearlyPrice : plan.monthlyPrice,
                period: isYearly ? "/year" : "/month",
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
    </section>
  );
}
