import { useState, useTransition } from "react";
import type { ReactNode } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { BackButton } from "@/components/ui/primitives/back-button";
import { PremiumFeatureGate } from "@/components/ui/primitives/upgrade-hint";
import { AnimatedSwap } from "@/components/ui/primitives/animated-swap";
import { Heading1 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import {
  NavigationMenu,
  NavigationMenuButtonItem,
  NavigationMenuItem,
  NavigationMenuToggleItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right";
import Users from "lucide-react/dist/esm/icons/users";
import Link2 from "lucide-react/dist/esm/icons/link-2";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Rss from "lucide-react/dist/esm/icons/rss";
import SlidersHorizontal from "lucide-react/dist/esm/icons/sliders-horizontal";
import Filter from "lucide-react/dist/esm/icons/filter";
import Code from "lucide-react/dist/esm/icons/code";
import Headphones from "lucide-react/dist/esm/icons/headphones";
import Check from "lucide-react/dist/esm/icons/check";
import Minus from "lucide-react/dist/esm/icons/minus";
import Infinity from "lucide-react/dist/esm/icons/infinity";
import CalendarClock from "lucide-react/dist/esm/icons/calendar-clock";
import Zap from "lucide-react/dist/esm/icons/zap";
import { NavigationMenuSegmented } from "@/components/ui/composites/navigation-menu/navigation-menu-segmented";
import { track, ANALYTICS_EVENTS, reportPurchaseConversion } from "@/lib/analytics";
import {
  fetchSubscriptionStateWithApi,
  useSubscription,
} from "@/hooks/use-subscription";
import type { SubscriptionState } from "@/hooks/use-subscription";
import { openCheckout, openCustomerPortal } from "@/utils/checkout";
import { getPlans } from "@/config/plans";
import type { PlanConfig } from "@/config/plans";
import { resolveUpgradeRedirect } from "@/lib/route-access-guards";
import type { PublicRuntimeConfig } from "@/lib/runtime-config";

export const Route = createFileRoute("/(dashboard)/dashboard/upgrade/")({
  beforeLoad: ({ context }) => {
    if (!context.runtimeConfig.commercialMode) {
      throw redirect({ to: "/dashboard" });
    }
  },
  loader: async ({ context }) => {
    const sessionRedirect = resolveUpgradeRedirect(
      context.auth.hasSession(),
      null,
    );
    if (sessionRedirect) {
      throw redirect({ to: sessionRedirect });
    }

    try {
      const subscription = await fetchSubscriptionStateWithApi(context.fetchApi);
      const redirectTarget = resolveUpgradeRedirect(
        true,
        subscription.plan,
      );
      if (redirectTarget) {
        throw redirect({ to: redirectTarget });
      }

      return { subscription };
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      return { subscription: { plan: null, interval: null } satisfies SubscriptionState };
    }
  },
  component: UpgradePage,
});

type FeatureValue = { kind: "check" } | { kind: "minus" } | { kind: "infinity" } | { kind: "number"; value: number } | { kind: "text"; value: string };

interface PlanFeature {
  icon: ReactNode;
  label: string;
  pro: FeatureValue;
  unlimited: FeatureValue;
}

const check: FeatureValue = { kind: "check" };
const minus: FeatureValue = { kind: "minus" };
const infinity: FeatureValue = { kind: "infinity" };
const num = (value: number): FeatureValue => ({ kind: "number", value });
const txt = (value: string): FeatureValue => ({ kind: "text", value });

const FEATURES: PlanFeature[] = [
  { icon: <Users size={15} />, label: "Linked Accounts", pro: num(2), unlimited: infinity },
  { icon: <Link2 size={15} />, label: "Sync Mappings", pro: num(3), unlimited: infinity },
  { icon: <RefreshCw size={15} />, label: "Sync Interval", pro: txt("30 min"), unlimited: txt("1 min") },
  { icon: <Rss size={15} />, label: "iCal Feed URL", pro: check, unlimited: check },
  { icon: <SlidersHorizontal size={15} />, label: "Feed Customization", pro: check, unlimited: check },
  { icon: <Filter size={15} />, label: "Event Filters", pro: check, unlimited: check },
  { icon: <Code size={15} />, label: "Daily API & MCP Calls", pro: txt("25"), unlimited: infinity },
  { icon: <Headphones size={15} />, label: "Priority Support", pro: minus, unlimited: check },
];

function resolvePlans(runtimeConfig: PublicRuntimeConfig): { proPlan: PlanConfig; unlimitedPlan: PlanConfig } {
  const allPlans = getPlans(runtimeConfig);

  const proPlan = allPlans.find((candidatePlan) => candidatePlan.id === "pro");
  if (!proPlan) {
    throw new Error("Missing pro plan configuration.");
  }

  const unlimitedPlan = allPlans.find((candidatePlan) => candidatePlan.id === "unlimited");
  if (!unlimitedPlan) {
    throw new Error("Missing unlimited plan configuration.");
  }

  return { proPlan, unlimitedPlan };
}

function resolveSavingsPercent(plan: PlanConfig): number {
  const monthlyTotal = plan.monthlyPrice * 12;
  return Math.ceil(((monthlyTotal - plan.yearlyPrice) / monthlyTotal) * 100);
}


function FeatureValueIndicator({ value }: { value: FeatureValue }) {
  if (value.kind === "check") {
    return <Check size={14} className="text-foreground-muted" />;
  }
  if (value.kind === "minus") {
    return <Minus size={14} className="text-foreground-disabled" />;
  }
  if (value.kind === "infinity") {
    return <Infinity size={14} className="text-foreground-muted" />;
  }
  if (value.kind === "number") {
    return <Text as="span" size="sm" tone="muted">{value.value}</Text>;
  }
  return <Text as="span" size="sm" tone="muted">{value.value}</Text>;
}

function UpgradePage() {
  const { runtimeConfig } = Route.useRouteContext();
  const { proPlan, unlimitedPlan } = resolvePlans(runtimeConfig);
  const { subscription: loaderSubscription } = Route.useLoaderData();
  const { data: subscription, isLoading, mutate } = useSubscription({
    fallbackData: loaderSubscription,
  });
  const [showUnlimited, setShowUnlimited] = useState(true);
  const [yearly, setYearly] = useState(false);
  const [isPending, startTransition] = useTransition();

  const currentPlan = subscription?.plan ?? null;
  const currentInterval = subscription?.interval ?? null;

  const selectedPlan = showUnlimited ? unlimitedPlan : proPlan;
  const planKey = showUnlimited ? "unlimited" : "pro";
  const price = yearly ? Math.round(selectedPlan.yearlyPrice / 12) : selectedPlan.monthlyPrice;
  let period = "/mo, billed monthly";
  if (yearly) {
    period = "/mo, billed annually";
  }
  const productId = yearly ? selectedPlan.yearlyProductId : selectedPlan.monthlyProductId;
  const savingsPercent = resolveSavingsPercent(selectedPlan);

  const isCurrent = currentPlan === selectedPlan.id;
  const isCurrentInterval =
    (currentInterval === "year" && yearly) ||
    (currentInterval === "month" && !yearly);

  let mode: "upgrade" | "manage" | "switch-interval" = "upgrade";
  if (isCurrent && isCurrentInterval) {
    mode = "manage";
  } else if (isCurrent && !isCurrentInterval) {
    mode = "switch-interval";
  }

  const handleUpgrade = () => {
    if (!productId) return;
    track(ANALYTICS_EVENTS.upgrade_started);
    startTransition(async () => {
      await openCheckout(productId, {
        onSuccess: () => {
          reportPurchaseConversion(runtimeConfig);
          mutate();
        },
      });
    });
  };

  const handleManage = () => {
    track(ANALYTICS_EVENTS.plan_managed);
    startTransition(async () => {
      await openCustomerPortal();
    });
  };

  const busy = isLoading || isPending;

  let handler: () => void;
  if (mode === "upgrade") {
    handler = handleUpgrade;
  } else {
    handler = handleManage;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <BackButton />

      <NavigationMenu>
        <NavigationMenuSegmented
          options={[
            { label: "Pro", value: "pro" },
            { label: "Unlimited", value: "unlimited" },
          ]}
          value={showUnlimited ? "unlimited" : "pro"}
          onValueChange={(planValue) => {
            track(ANALYTICS_EVENTS.upgrade_plan_toggled, { plan: planValue });
            setShowUnlimited(planValue === "unlimited");
          }}
        />
      </NavigationMenu>

      <div className="flex flex-col gap-0.5 px-0.5 py-3">
        <div className="flex items-baseline gap-1">
          <AnimatedSwap swapKey={`price-${price}`}>
            <Heading1 as="span" className="tabular-nums">${price}</Heading1>
          </AnimatedSwap>
          <Text as="span" size="sm" tone="muted">{period}</Text>
        </div>
        <Text size="sm" tone="muted">{selectedPlan.description}</Text>
      </div>

      <PremiumFeatureGate
        locked={true}
        interactive={true}
        footer={<Text size="sm" tone="muted" align="center">Save {savingsPercent}% with annual billing.</Text>}
      >
        <NavigationMenu>
          <NavigationMenuToggleItem checked={yearly} onCheckedChange={(checked) => {
            track(ANALYTICS_EVENTS.upgrade_billing_toggled, { annual: checked });
            setYearly(checked);
          }}>
            <NavigationMenuItemIcon>
              <CalendarClock size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>Annual Billing</NavigationMenuItemLabel>
          </NavigationMenuToggleItem>
        </NavigationMenu>
      </PremiumFeatureGate>

      <NavigationMenu>
        {FEATURES.map((feature) => {
          const featureValue = feature[planKey];
          const dimmed = featureValue.kind === "minus";
          const valueChanges = JSON.stringify(feature.pro) !== JSON.stringify(feature.unlimited);
          return (
            <NavigationMenuItem key={feature.label} className={dimmed ? "opacity-40" : ""}>
              <NavigationMenuItemIcon>
                {feature.icon}
              </NavigationMenuItemIcon>
              <NavigationMenuItemLabel>{feature.label}</NavigationMenuItemLabel>
              <NavigationMenuItemTrailing>
                {valueChanges ? (
                  <AnimatedSwap swapKey={`${feature.label}-${planKey}`}>
                    <FeatureValueIndicator value={featureValue} />
                  </AnimatedSwap>
                ) : (
                  <FeatureValueIndicator value={featureValue} />
                )}
              </NavigationMenuItemTrailing>
            </NavigationMenuItem>
          );
        })}
      </NavigationMenu>

      <NavigationMenu variant="highlight">
        <NavigationMenuButtonItem onClick={handler} disabled={busy}>
          <NavigationMenuItemIcon>
            <Zap size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>
            Subscribe to <AnimatedSwap swapKey={`plan-${selectedPlan.id}`}>{selectedPlan.name}</AnimatedSwap>
          </NavigationMenuItemLabel>
          <NavigationMenuItemTrailing>
            <ArrowRight size={15} className="text-white" />
          </NavigationMenuItemTrailing>
        </NavigationMenuButtonItem>
      </NavigationMenu>
    </div>
  );
}
