import MoreHorizontal from "lucide-react/dist/esm/icons/ellipsis";
import {
  NavigationMenu,
  NavigationMenuLinkItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { ProviderIcon } from "@/components/ui/primitives/provider-icon";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";

const COMMON_PROVIDERS = [
  { label: "Google Calendar", path: "/dashboard/connect/google", provider: "google" },
  { label: "Outlook or Microsoft 365", path: "/dashboard/connect/outlook", provider: "outlook" },
  { label: "iCloud", path: "/dashboard/connect/apple", provider: "icloud" },
] as const;

interface ProviderOptionsProps {
  step: string;
}

export function ProviderOptions({ step }: ProviderOptionsProps) {
  const choose = (provider: string) => {
    track(ANALYTICS_EVENTS.onboarding_provider_chosen, { onboarding_step: step, provider_name: provider });
  };

  return (
    <>
      <NavigationMenu>
        {COMMON_PROVIDERS.map(({ label, path, provider }) => (
          <div key={provider} onClickCapture={() => choose(provider)}>
            <NavigationMenuLinkItem to={path}>
              <NavigationMenuItemIcon>
                <ProviderIcon provider={provider} />
              </NavigationMenuItemIcon>
              <NavigationMenuItemLabel>{label}</NavigationMenuItemLabel>
              <NavigationMenuItemTrailing />
            </NavigationMenuLinkItem>
          </div>
        ))}
      </NavigationMenu>
      <NavigationMenu>
        <div onClickCapture={() => choose("other")}>
          <NavigationMenuLinkItem to="/dashboard/connect">
            <NavigationMenuItemIcon>
              <MoreHorizontal size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>Fastmail, CalDAV or a calendar link</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing />
          </NavigationMenuLinkItem>
        </div>
      </NavigationMenu>
    </>
  );
}
