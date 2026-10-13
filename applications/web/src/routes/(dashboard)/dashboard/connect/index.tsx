import { createFileRoute } from "@tanstack/react-router";
import { BackButton } from "@/components/ui/primitives/back-button";
import { ANALYTICS_EVENTS } from "@/lib/analytics";
import { CONNECT_PROVIDERS, CONNECT_PROVIDER_GROUPS } from "@/lib/connect-providers";
import { PremiumGate } from "@/components/ui/primitives/menu-hint";
import { ConnectProviderIcon } from "@/components/ui/primitives/connect-provider-icon";
import { useEntitlements, canAddMore } from "@/hooks/use-entitlements";
import {
  NavigationMenu,
  NavigationMenuLinkItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";

export const Route = createFileRoute("/(dashboard)/dashboard/connect/")({
  component: ConnectPage,
});

function ConnectPage() {
  const { data: entitlements } = useEntitlements();
  const atLimit = !canAddMore(entitlements?.accounts);

  return (
    <div className="flex flex-col gap-1.5">
      <BackButton />
      <PremiumGate locked={atLimit} hint="Account limit reached.">
        {CONNECT_PROVIDER_GROUPS.map((group) => (
          <NavigationMenu key={group}>
            {CONNECT_PROVIDERS.filter((provider) => provider.group === group).map((provider) => (
              <div
                key={provider.id}
                data-visitors-event={ANALYTICS_EVENTS.calendar_connect_started}
                data-visitors-provider={provider.analyticsProvider}
              >
                <NavigationMenuLinkItem to={provider.to} disabled={atLimit}>
                  <NavigationMenuItemIcon>
                    <ConnectProviderIcon provider={provider} />
                  </NavigationMenuItemIcon>
                  <NavigationMenuItemLabel>{provider.label}</NavigationMenuItemLabel>
                  <NavigationMenuItemTrailing />
                </NavigationMenuLinkItem>
              </div>
            ))}
          </NavigationMenu>
        ))}
      </PremiumGate>
    </div>
  );
}
