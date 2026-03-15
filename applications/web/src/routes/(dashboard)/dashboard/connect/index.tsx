import { createFileRoute } from "@tanstack/react-router";
import Calendar from "lucide-react/dist/esm/icons/calendar";
import LinkIcon from "lucide-react/dist/esm/icons/link";
import { BackButton } from "@/components/ui/primitives/back-button";
import { PremiumFeatureGate } from "@/components/ui/primitives/upgrade-hint";
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
      <PremiumFeatureGate locked={atLimit} hint="Account limit reached.">
        <NavigationMenu>
          <NavigationMenuLinkItem to="/dashboard/connect/ical-link" disabled={atLimit}>
            <NavigationMenuItemIcon>
              <LinkIcon size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>Subscribe to ICS Calendar Feed</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing />
          </NavigationMenuLinkItem>
        </NavigationMenu>
        <NavigationMenu>
          <NavigationMenuLinkItem to="/dashboard/connect/google" disabled={atLimit}>
            <NavigationMenuItemIcon>
              <img src="/integrations/icon-google.svg" alt="" width={15} height={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>Connect Google Calendar</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing />
          </NavigationMenuLinkItem>
          <NavigationMenuLinkItem to="/dashboard/connect/outlook" disabled={atLimit}>
            <NavigationMenuItemIcon>
              <img src="/integrations/icon-outlook.svg" alt="" width={15} height={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>Connect Outlook</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing />
          </NavigationMenuLinkItem>
          <NavigationMenuLinkItem to="/dashboard/connect/apple" disabled={atLimit}>
            <NavigationMenuItemIcon>
              <img src="/integrations/icon-icloud.svg" alt="" width={15} height={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>Connect iCloud</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing />
          </NavigationMenuLinkItem>
          <NavigationMenuLinkItem to="/dashboard/connect/microsoft" disabled={atLimit}>
            <NavigationMenuItemIcon>
              <img src="/integrations/icon-microsoft-365.svg" alt="" width={15} height={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>Connect Microsoft 365</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing />
          </NavigationMenuLinkItem>
          <NavigationMenuLinkItem to="/dashboard/connect/fastmail" disabled={atLimit}>
            <NavigationMenuItemIcon>
              <img src="/integrations/icon-fastmail.svg" alt="" width={15} height={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>Connect Fastmail</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing />
          </NavigationMenuLinkItem>
        </NavigationMenu>
        <NavigationMenu>
          <NavigationMenuLinkItem to="/dashboard/connect/caldav" disabled={atLimit}>
            <NavigationMenuItemIcon>
              <Calendar size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>Connect CalDAV Server</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing />
          </NavigationMenuLinkItem>
        </NavigationMenu>
      </PremiumFeatureGate>
    </div>
  );
}
