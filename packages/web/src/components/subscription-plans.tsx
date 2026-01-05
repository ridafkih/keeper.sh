"use client";

import type { FC } from "react";
import { useState } from "react";
import { Toast } from "@/components/toast-provider";
import { PlanCard } from "@/components/plan-card";
import { Section } from "@/components/section";
import { SectionHeader } from "@/components/section-header";
import { BillingPeriodToggle } from "@/components/billing-period-toggle";
import type { BillingPeriod } from "@/components/billing-period-toggle";
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
  if (override) {
    return override;
  }
  if (interval === "year") {
    return "yearly";
  }
  return "monthly";
};

const getConversionValue = (totalAmount: number | null): number | null => {
  if (totalAmount) {
    return totalAmount / 100;
  }
  return null;
};

interface Plan {
  yearlyProductId: string | null;
  monthlyProductId: string | null;
  yearlyPrice: number;
  monthlyPrice: number;
}

const getProductId = (plan: Plan, isYearly: boolean): string | null => {
  if (isYearly) {
    return plan.yearlyProductId;
  }
  return plan.monthlyProductId;
};

const getPrice = (plan: Plan, isYearly: boolean): number => {
  if (isYearly) {
    return plan.yearlyPrice;
  }
  return plan.monthlyPrice;
};

const getPeriodText = (isYearly: boolean): string => {
  if (isYearly) {
    return " per year";
  }
  return " per month";
};

const getPeriod = (showPeriodText: boolean, periodText: string): string => {
  if (showPeriodText) {
    return periodText;
  }
  return "";
};

export const SubscriptionPlans: FC<SubscriptionPlansProps> = ({
  currentPlan,
  currentInterval,
  isSubscriptionLoading,
  onSubscriptionChange,
}) => {
  const toastManager = Toast.useToastManager();
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [billingPeriodOverride, setBillingPeriodOverride] = useState<BillingPeriod | null>(null);

  const billingPeriod = deriveBillingPeriod(billingPeriodOverride, currentInterval);

  const handleUpgrade = async (productId: string): Promise<void> => {
    setIsCheckoutLoading(true);

    try {
      await openCheckout(productId, {
        onSuccess: (data) => {
          const conversionValue = getConversionValue(data.totalAmount ?? null);
          reportPurchaseConversion({
            currency: data.currency ?? null,
            transactionId: data.id ?? null,
            value: conversionValue,
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

  const handleManage = async (): Promise<void> => {
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

      <BillingPeriodToggle value={billingPeriod} onChange={setBillingPeriodOverride} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-3xl">
        {plans.map((plan) => {
          const productId = getProductId(plan, isYearly);
          const periodText = getPeriodText(isYearly);
          const showPeriodText = plan.monthlyPrice > 0;
          const price = getPrice(plan, isYearly);
          const period = getPeriod(showPeriodText, periodText);

          return (
            <PlanCard
              key={plan.id}
              plan={{
                ...plan,
                price,
                period,
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
