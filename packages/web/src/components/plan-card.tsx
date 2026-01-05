import type { ReactNode } from "react";
import { Check, MinusIcon } from "lucide-react";
import { Button } from "@base-ui/react/button";
import { tv } from "tailwind-variants";
import type { PlanConfig } from "@/config/plans";
import { button } from "@/styles";

const pricingCard = tv({
  base: "flex flex-col p-5 border rounded-lg transition-colors",
  defaultVariants: {
    current: false,
    featured: false,
    muted: false,
  },
  variants: {
    current: {
      false: "",
      true: "border-border-emphasis",
    },
    featured: {
      false: "border-border bg-surface",
      true: "border-border-emphasis bg-surface-subtle shadow-sm",
    },
    muted: {
      false: "",
      true: "opacity-75",
    },
  },
});

const pricingBadge = tv({
  base: "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
  variants: {
    skeleton: {
      true: "opacity-0",
    },
    variant: {
      current: "bg-primary text-primary-foreground",
      popular: "bg-info-surface text-info",
    },
  },
});

const pricingFeatureIcon = tv({
  base: "w-4 h-4 shrink-0",
  variants: {
    included: {
      false: "text-foreground-disabled",
      true: "text-success",
    },
  },
});

const pricingFeatureText = tv({
  variants: {
    included: {
      false: "text-foreground-subtle",
      true: "",
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

const FeatureIcon = ({ included }: { included: boolean }): ReactNode => {
  const Icon = ((): typeof Check | typeof MinusIcon => {
    if (included) {
      return Check;
    }
    return MinusIcon;
  })();
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
}: PlanCardProps): ReactNode => {
  if (isSubscriptionLoading) {
    return (
      <Button className={button({ skeleton: true, variant: "secondary" })} disabled>
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
    const label = ((): string => {
      if (targetInterval === "yearly") {
        return "Switch to Yearly";
      }
      return "Switch to Monthly";
    })();
    const buttonText = ((): string => {
      if (isLoading) {
        return "Loading...";
      }
      return label;
    })();
    return (
      <Button
        className={button({ variant: "primary" })}
        onClick={onSwitchInterval}
        disabled={isLoading}
      >
        {buttonText}
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

  const upgradeButtonText = ((): string => {
    if (isLoading) {
      return "Loading...";
    }
    return `Upgrade to ${plan.name}`;
  })();
  return (
    <Button className={button({ variant: "primary" })} onClick={onUpgrade} disabled={isLoading}>
      {upgradeButtonText}
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
}: PlanCardProps): ReactNode => {
  const showCurrentBadge = !isSubscriptionLoading && isCurrent && isCurrentInterval;

  return (
    <div
      className={pricingCard({
        current: showCurrentBadge,
        featured: plan.popular,
        muted: !plan.popular,
      })}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm tracking-tight font-semibold text-foreground">{plan.name}</h3>
        <div className="flex gap-1.5">
          {(isSubscriptionLoading || showCurrentBadge) && (
            <span
              className={pricingBadge({
                skeleton: isSubscriptionLoading,
                variant: "current",
              })}
            >
              Current
            </span>
          )}
          {plan.popular && <span className={pricingBadge({ variant: "popular" })}>Popular</span>}
        </div>
      </div>

      <div className="mb-3">
        <span className="text-3xl font-bold tracking-tight text-foreground">${plan.price}</span>
        <span className="text-sm text-foreground-muted font-normal">{plan.period}</span>
      </div>

      <p className="text-sm text-foreground-muted mb-4">{plan.description}</p>

      <ul className="flex flex-col gap-2 mb-5 flex-1">
        {plan.features.map((feature) => (
          <li
            key={feature.name}
            className="flex items-center gap-2 text-sm text-foreground-secondary"
          >
            <FeatureIcon included={feature.included} />
            <span className={pricingFeatureText({ included: feature.included })}>
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
