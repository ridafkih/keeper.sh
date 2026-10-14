import CalendarPlus from "lucide-react/dist/esm/icons/calendar-plus";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Waypoints from "lucide-react/dist/esm/icons/waypoints";
import KeeperLogo from "@/assets/keeper.svg?react";
import { Button, ButtonText } from "@/components/ui/primitives/button";
import { Heading2 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuItemIcon,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";

const POINTS = [
  { description: "Google, Outlook, iCloud, CalDAV and more", icon: CalendarPlus, title: "Connect your calendars" },
  { description: "Block your time, or share the details", icon: Waypoints, title: "Choose what syncs where" },
  { description: "Changes copy over within minutes", icon: RefreshCw, title: "Keeper keeps them in step" },
];

export function WelcomeStep({ onStart }: { onStart: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-2">
      <div className="flex justify-center pb-4">
        <div className="flex size-14 items-center justify-center rounded-xl border border-interactive-border bg-background-inverse p-3 shadow-xs">
          <KeeperLogo className="size-full p-1 text-foreground-inverse" />
        </div>
      </div>
      <Heading2 as="h1" className="text-center">Welcome to Keeper</Heading2>
      <Text size="sm" tone="muted" align="center" className="pb-3">
        Keeper copies events between your calendars, so each one knows when you&apos;re busy. Setup takes about two minutes.
      </Text>
      <NavigationMenu>
        {POINTS.map(({ description, icon: Icon, title }) => (
          <NavigationMenuItem key={title}>
            <NavigationMenuItemIcon>
              <Icon size={15} />
            </NavigationMenuItemIcon>
            <div className="flex min-w-0 flex-col">
              <Text size="sm" tone="default" className="truncate">{title}</Text>
              <Text size="xs" tone="muted" className="truncate">{description}</Text>
            </div>
          </NavigationMenuItem>
        ))}
      </NavigationMenu>
      <Button className="mt-4 w-full justify-center" onClick={onStart}>
        <ButtonText>Get Started</ButtonText>
      </Button>
    </div>
  );
}
