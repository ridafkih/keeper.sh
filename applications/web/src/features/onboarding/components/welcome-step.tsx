import Circle from "lucide-react/dist/esm/icons/circle";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { OnboardingHeading } from "./onboarding-heading";
import { ProviderOptions } from "./provider-options";

const CHECKLIST = ["Connect a calendar", "Add where busy time shows", "Start syncing"];

export function WelcomeStep() {
  return (
    <>
      <OnboardingHeading
        title="Sync your calendars"
        description="Keeper.sh copies events between your calendars as busy time, so each one shows when you're free."
      />
      <NavigationMenu>
        {CHECKLIST.map((item, index) => (
          <NavigationMenuItem key={item}>
            <NavigationMenuItemIcon>
              <Circle size={15} className={index === 0 ? "text-foreground" : undefined} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel tone={index === 0 ? "default" : "disabled"}>{item}</NavigationMenuItemLabel>
          </NavigationMenuItem>
        ))}
      </NavigationMenu>
      <ProviderOptions step="welcome" />
    </>
  );
}
