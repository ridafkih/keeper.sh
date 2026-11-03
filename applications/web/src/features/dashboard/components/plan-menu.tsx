import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import CreditCard from "lucide-react/dist/esm/icons/credit-card";
import Sparkles from "lucide-react/dist/esm/icons/sparkles";
import {
  NavigationMenuButtonItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { useSubscription, type SubscriptionState } from "@/hooks/use-subscription";
import { openCustomerPortal } from "@/utils/checkout";

interface PlanMenuItemProps {
  subscription: SubscriptionState | undefined;
  subscriptionLoading: boolean;
}

export function PlanMenuItem({ subscription, subscriptionLoading }: PlanMenuItemProps) {
  const navigate = useNavigate();
  const isPro = subscription?.plan === "pro";
  const [isManaging, setIsManaging] = useState(false);

  const handleManagePlan = async () => {
    if (!isPro) {
      navigate({ to: "/dashboard/upgrade" });
      return;
    }
    setIsManaging(true);
    try {
      await openCustomerPortal();
    } catch {
      setIsManaging(false);
    }
  };

  return (
    <NavigationMenuButtonItem onClick={handleManagePlan} disabled={isManaging || subscriptionLoading}>
      <NavigationMenuItemIcon>
        {isPro ? <CreditCard size={15} /> : <Sparkles size={15} />}
      </NavigationMenuItemIcon>
      <NavigationMenuItemLabel>{isPro ? "Manage Plan" : "Upgrade to Pro"}</NavigationMenuItemLabel>
      <NavigationMenuItemTrailing />
    </NavigationMenuButtonItem>
  );
}

export function SettingsPlanMenuItem() {
  const { data: subscription, isLoading } = useSubscription();
  return <PlanMenuItem subscription={subscription} subscriptionLoading={isLoading} />;
}
