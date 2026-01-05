import type { FC } from "react";
import Link from "next/link";
import { Check, MinusIcon } from "lucide-react";
import { Button } from "@base-ui/react/button";
import { Switch } from "@base-ui/react/switch";
import { tv } from "tailwind-variants";
import type { PlanConfig } from "@/config/plans";
import { button } from "@/styles";

const card = tv({
  base: "flex flex-col p-5 border rounded-lg",
  defaultVariants: {
    featured: false,
  },
  variants: {
    featured: {
      false: "border-border bg-surface",
      true: "border-border-emphasis bg-surface-subtle shadow-sm",
    },
  },
});

const featureIcon = tv({
  base: "w-4 h-4 shrink-0",
  variants: {
    included: {
      false: "text-foreground-disabled",
      true: "text-success",
    },
  },
});

interface PricingCardProps {
  plan: PlanConfig;
  isYearly: boolean;
  onBillingChange: (yearly: boolean) => void;
}

const PricingCard: FC<PricingCardProps> = ({ plan, isYearly, onBillingChange }) => {
  const isFree = plan.monthlyPrice === 0;
  const price = ((): string => {
    if (isYearly) {
      return (plan.yearlyPrice / 12).toFixed(2);
    }
    return plan.monthlyPrice.toFixed(2);
  })();
  const period = ((): string => {
    if (isYearly) {
      return " per month billed yearly";
    }
    return " per month";
  })();
  const buttonVariant = ((): "primary" | "secondary" => {
    if (plan.popular) {
      return "primary";
    }
    return "secondary";
  })();

  return (
    <div className={card({ featured: plan.popular })}>
      <PricingCardHeader name={plan.name} popular={plan.popular} />
      <PricingCardPrice price={price} period={period} showPeriod={!isFree} />
      <BillingToggle isYearly={isYearly} onChange={onBillingChange} hidden={isFree} />
      <p className="text-sm text-foreground-muted mb-4">{plan.description}</p>
      <PricingCardFeatures features={plan.features} />
      <Button
        render={<Link href="/register" />}
        nativeButton={false}
        className={button({ variant: buttonVariant })}
      >
        Get Started
      </Button>
    </div>
  );
};

const PricingCardHeader: FC<{ name: string; popular?: boolean }> = ({ name, popular }) => (
  <div className="flex items-center justify-between mb-3">
    <h3 className="text-sm tracking-tight font-semibold text-foreground">{name}</h3>
    {popular && (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-info-surface text-info">
        Popular
      </span>
    )}
  </div>
);

const PricingCardPrice: FC<{
  price: number | string;
  period: string;
  showPeriod: boolean;
}> = ({ price, period, showPeriod }) => (
  <div className="mb-2">
    <span className="text-3xl font-bold tracking-tight text-foreground">${price}</span>
    {showPeriod && <span className="text-sm text-foreground-muted font-normal">{period}</span>}
  </div>
);

const BillingToggle: FC<{
  isYearly: boolean;
  onChange: (yearly: boolean) => void;
  hidden: boolean;
}> = ({ isYearly, onChange, hidden }) => {
  const visibilityClass = ((): string => {
    if (hidden) {
      return "invisible";
    }
    return "";
  })();
  return (
    <label
      htmlFor="billing-toggle"
      className={`flex items-center gap-2 mb-4 cursor-pointer ${visibilityClass}`}
    >
      <Switch.Root
        id="billing-toggle"
        checked={isYearly}
        onCheckedChange={onChange}
        className="relative inline-flex items-center w-8 h-5 rounded-full bg-surface-muted data-checked:bg-success transition-colors"
      >
        <Switch.Thumb className="block size-4 rounded-full bg-white shadow-sm translate-x-0.5 data-checked:translate-x-3.5 transition-transform" />
      </Switch.Root>
      <span className="text-xs text-foreground-muted">
        Yearly billing
        <span className="ml-1.5 inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-success-surface text-success-emphasis">
          -30%
        </span>
      </span>
    </label>
  );
};

const PricingCardFeatures: FC<{
  features: PlanConfig["features"];
}> = ({ features }) => (
  <ul className="flex flex-col gap-2 mb-5 flex-1">
    {features.map((feature) => {
      const Icon = ((): typeof Check | typeof MinusIcon => {
        if (feature.included) {
          return Check;
        }
        return MinusIcon;
      })();
      const featureTextClass = ((): string => {
        if (feature.included) {
          return "";
        }
        return "text-foreground-subtle";
      })();
      return (
        <li
          key={feature.name}
          className="flex items-center gap-2 text-sm text-foreground-secondary"
        >
          <Icon className={featureIcon({ included: feature.included })} />
          <span className={featureTextClass}>{feature.name}</span>
        </li>
      );
    })}
  </ul>
);

export { PricingCard };
