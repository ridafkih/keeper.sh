import { Check, X } from "lucide-react";
import { Button } from "@base-ui/react/button";
import { tv } from "tailwind-variants";
import type { PlanConfig } from "@/config/plans";
import { button } from "@/styles";

const pricingCard = tv({
  base: "flex flex-col p-5 border rounded-lg transition-colors",
  variants: {
    current: {
      true: "border-zinc-900",
      false: "",
    },
    featured: {
      true: "border-zinc-900 bg-zinc-50 shadow-sm",
      false: "border-zinc-200 bg-white",
    },
    muted: {
      true: "opacity-75",
      false: "",
    },
  },
  defaultVariants: {
    current: false,
    featured: false,
    muted: false,
  },
});

const pricingBadge = tv({
  base: "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
  variants: {
    variant: {
      current: "bg-zinc-900 text-white",
      popular: "bg-blue-100 text-blue-800",
    },
    skeleton: {
      true: "opacity-0",
    },
  },
});

const pricingFeatureIcon = tv({
  base: "w-4 h-4 shrink-0",
  variants: {
    included: {
      true: "text-green-600",
      false: "text-zinc-300",
    },
  },
});

const pricingFeatureText = tv({
  variants: {
    included: {
      true: "",
      false: "text-zinc-400",
    },
  },
});

type Plan = Omit<
  PlanConfig,
  "monthlyPrice" | "yearlyPrice" | "monthlyProductId" | "yearlyProductId"
> & {
  price: number;
  period: string;
};

interface PlanCardProps {
  plan: Plan;
  isCurrent: boolean;
  isCurrentInterval: boolean;
  isLoading: boolean;
  isSubscriptionLoading?: boolean;
  onUpgrade: () => void;
  onManage: () => void;
  onSwitchInterval: () => void;
  targetInterval: "monthly" | "yearly";
}

const FeatureIcon = ({ included }: { included: boolean }) => {
  const Icon = included ? Check : X;
  return <Icon className={pricingFeatureIcon({ included })} />;
};

const PlanCardButton = ({
  plan,
  isCurrent,
  isCurrentInterval,
  isLoading,
  isSubscriptionLoading,
  onUpgrade,
  onManage,
  onSwitchInterval,
  targetInterval,
}: PlanCardProps) => {
  if (isSubscriptionLoading) {
    return (
      <Button
        className={button({ variant: "secondary", skeleton: true })}
        disabled
      >
        Upgrade
      </Button>
    );
  }

  if (isCurrent && plan.id === "free") {
    return (
      <Button className={button({ variant: "secondary" })} disabled>
        Current Plan
      </Button>
    );
  }

  if (isCurrent && isCurrentInterval) {
    return (
      <Button className={button({ variant: "secondary" })} onClick={onManage}>
        Manage Subscription
      </Button>
    );
  }

  if (isCurrent && !isCurrentInterval) {
    const label =
      targetInterval === "yearly" ? "Switch to Yearly" : "Switch to Monthly";
    return (
      <Button
        className={button({ variant: "primary" })}
        onClick={onSwitchInterval}
        disabled={isLoading}
      >
        {isLoading ? "Loading..." : label}
      </Button>
    );
  }

  if (plan.id === "free") {
    return (
      <Button className={button({ variant: "secondary" })} onClick={onManage}>
        Downgrade
      </Button>
    );
  }

  return (
    <Button
      className={button({ variant: "primary" })}
      onClick={onUpgrade}
      disabled={isLoading}
    >
      {isLoading ? "Loading..." : `Upgrade to ${plan.name}`}
    </Button>
  );
};

export const PlanCard = ({
  plan,
  isCurrent,
  isCurrentInterval,
  isLoading,
  isSubscriptionLoading,
  onUpgrade,
  onManage,
  onSwitchInterval,
  targetInterval,
}: PlanCardProps) => {
  const showCurrentBadge =
    !isSubscriptionLoading && isCurrent && isCurrentInterval;

  return (
    <div
      className={pricingCard({
        current: showCurrentBadge,
        featured: plan.popular,
        muted: !plan.popular,
      })}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm tracking-tight font-semibold text-zinc-900">
          {plan.name}
        </h3>
        <div className="flex gap-1.5">
          {(isSubscriptionLoading || showCurrentBadge) && (
            <span
              className={pricingBadge({
                variant: "current",
                skeleton: isSubscriptionLoading,
              })}
            >
              Current
            </span>
          )}
          {plan.popular && (
            <span className={pricingBadge({ variant: "popular" })}>
              Popular
            </span>
          )}
        </div>
      </div>

      <div className="mb-3">
        <span className="text-3xl font-bold tracking-tight text-zinc-900">
          ${plan.price}
        </span>
        <span className="text-sm text-zinc-500 font-normal">{plan.period}</span>
      </div>

      <p className="text-sm text-zinc-500 mb-4">{plan.description}</p>

      <ul className="flex flex-col gap-2 mb-5 flex-1">
        {plan.features.map((feature) => (
          <li
            key={feature.name}
            className="flex items-center gap-2 text-sm text-zinc-600"
          >
            <FeatureIcon included={feature.included} />
            <span
              className={pricingFeatureText({ included: feature.included })}
            >
              {feature.name}
            </span>
          </li>
        ))}
      </ul>

      <PlanCardButton
        plan={plan}
        isCurrent={isCurrent}
        isCurrentInterval={isCurrentInterval}
        isLoading={isLoading}
        isSubscriptionLoading={isSubscriptionLoading}
        onUpgrade={onUpgrade}
        onManage={onManage}
        onSwitchInterval={onSwitchInterval}
        targetInterval={targetInterval}
      />
    </div>
  );
};
