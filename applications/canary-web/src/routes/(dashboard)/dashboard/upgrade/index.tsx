import { useState, useTransition } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BackButton } from "../../../../components/ui/back-button";
import { DashboardHeading1 } from "../../../../components/ui/dashboard-heading";
import { Heading2, Heading3 } from "../../../../components/ui/heading";
import { Text } from "../../../../components/ui/text";
import { Button, ButtonText } from "../../../../components/ui/button";
import {
  NavigationMenu,
  NavigationMenuCheckboxItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
} from "../../../../components/ui/navigation-menu";
import {
  MarketingPricingCard,
  MarketingPricingCardAction,
  MarketingPricingCardBody,
  MarketingPricingCardCopy,
} from "../../../../components/marketing/marketing-pricing-section";
import { CalendarClock, Check, Infinity } from "lucide-react";
import { MetadataRow } from "../../../../components/dashboard/metadata-row";
import { useSubscription } from "../../../../hooks/use-subscription";
import { openCheckout, openCustomerPortal } from "../../../../utils/checkout";
import { plans } from "../../../../config/plans";

export const Route = createFileRoute("/(dashboard)/dashboard/upgrade/")(
  { component: UpgradePage },
);

const pro = plans.find((p) => p.id === "pro")!;

function UpgradePage() {
  const { data: subscription, isLoading, mutate } = useSubscription();
  const [yearly, setYearly] = useState(false);
  const [isPending, startTransition] = useTransition();

  const currentPlan = subscription?.plan ?? "free";
  const currentInterval = subscription?.interval;
  const isCurrent = currentPlan === "pro";
  const isCurrentInterval =
    (currentInterval === "year" && yearly) ||
    (currentInterval === "month" && !yearly);

  const price = yearly ? pro.yearlyPrice : pro.monthlyPrice;
  const period = yearly ? "per year" : "per month";
  const productId = yearly ? pro.yearlyProductId : pro.monthlyProductId;

  const handleUpgrade = () => {
    if (!productId) return;
    startTransition(async () => {
      await openCheckout(productId, { onSuccess: () => mutate() });
    });
  };

  const handleManage = () => {
    startTransition(async () => {
      await openCustomerPortal();
    });
  };

  const busy = isLoading || isPending;

  return (
    <div className="flex flex-col gap-1.5">
      <BackButton />

      <div className="flex flex-col px-0.5 pt-4">
        <DashboardHeading1>Upgrade to Pro</DashboardHeading1>
        <Text size="sm">
          Thank you for supporting the project. I maintain Keeper on my own time and dime so all support is appreciated.
        </Text>
      </div>

      <MarketingPricingCard tone="inverse">
        <MarketingPricingCardBody>
          <Heading3 className="text-foreground-inverse">{pro.name}</Heading3>
          <div className="flex items-baseline gap-1">
            <Heading2 className="text-foreground-inverse">${price}</Heading2>
            <Text size="sm" tone="inverseMuted" align="left">
              {period}
            </Text>
          </div>
          <MarketingPricingCardCopy>
            <Text size="sm" tone="inverseMuted" align="left">
              {pro.description}
            </Text>
          </MarketingPricingCardCopy>
        </MarketingPricingCardBody>
        <MarketingPricingCardAction>
          <UpgradeAction
            isCurrent={isCurrent}
            isCurrentInterval={isCurrentInterval}
            isLoading={busy}
            onUpgrade={handleUpgrade}
            onManage={handleManage}
          />
        </MarketingPricingCardAction>
      </MarketingPricingCard>

      <NavigationMenu>
        <MetadataRow label="Sync Interval" value="Every 1 minute" />
        <MetadataRow label="Linked Calendar Accounts" icon={<Infinity size={15} />} />
        <MetadataRow label="Calendars per Account" icon={<Infinity size={15} />} />
        <MetadataRow label="Aggregated iCal Link" icon={<Check size={15} />} />
        <MetadataRow label="Priority Support" icon={<Check size={15} />} />
      </NavigationMenu>

      <NavigationMenu>
        <NavigationMenuCheckboxItem checked={yearly} onCheckedChange={setYearly}>
          <NavigationMenuItemIcon>
            <CalendarClock size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>
            Annual billing
          </NavigationMenuItemLabel>
        </NavigationMenuCheckboxItem>
      </NavigationMenu>
    </div>
  );
}

interface UpgradeActionProps {
  isCurrent: boolean;
  isCurrentInterval: boolean;
  isLoading: boolean;
  onUpgrade: () => void;
  onManage: () => void;
}

function UpgradeAction({ isCurrent, isCurrentInterval, isLoading, onUpgrade, onManage }: UpgradeActionProps) {
  const base = "w-full justify-center border-transparent";

  if (isCurrent && isCurrentInterval) {
    return (
      <Button variant="border" className={base} onClick={onManage} disabled={isLoading}>
        <ButtonText>Manage Subscription</ButtonText>
      </Button>
    );
  }

  if (isCurrent) {
    return (
      <Button variant="border" className={base} onClick={onManage} disabled={isLoading}>
        <ButtonText>Switch Billing Period</ButtonText>
      </Button>
    );
  }

  return (
    <Button variant="border" className={base} onClick={onUpgrade} disabled={isLoading}>
      <ButtonText>{isLoading ? "Loading..." : "Upgrade to Pro"}</ButtonText>
    </Button>
  );
}
