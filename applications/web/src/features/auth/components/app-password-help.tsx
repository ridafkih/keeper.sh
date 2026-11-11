import type { ReactNode } from "react";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import KeyRound from "lucide-react/dist/esm/icons/key-round";
import Copy from "lucide-react/dist/esm/icons/copy";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { ExternalTextLink } from "@/components/ui/primitives/text-link";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";

interface AppPasswordHelpProps {
  provider: string;
  settingsUrl: string;
  settingsLabel: string;
  sectionLabel: ReactNode;
}

export function AppPasswordHelp({ provider, settingsUrl, settingsLabel, sectionLabel }: AppPasswordHelpProps) {
  return (
    <NavigationMenu>
      <NavigationMenuItem>
        <NavigationMenuItemIcon>
          <ExternalLink size={15} />
        </NavigationMenuItemIcon>
        <ExternalTextLink
          href={settingsUrl}
          target="_blank"
          rel="noreferrer"
          tone="default"
          align="left"
          onClick={() => track(ANALYTICS_EVENTS.onboarding_help_link_opened, { provider })}
        >
          {settingsLabel}
        </ExternalTextLink>
      </NavigationMenuItem>
      <NavigationMenuItem>
        <NavigationMenuItemIcon>
          <KeyRound size={15} />
        </NavigationMenuItemIcon>
        <NavigationMenuItemLabel>{sectionLabel}</NavigationMenuItemLabel>
      </NavigationMenuItem>
      <NavigationMenuItem>
        <NavigationMenuItemIcon>
          <Copy size={15} />
        </NavigationMenuItemIcon>
        <NavigationMenuItemLabel>Generate one and paste it above</NavigationMenuItemLabel>
      </NavigationMenuItem>
    </NavigationMenu>
  );
}
