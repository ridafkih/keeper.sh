import { CheckboxIndicator } from "@/components/ui/primitives/checkbox";
import { Text } from "@/components/ui/primitives/text";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
  NavigationMenuLinkItem,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { resolveSetupSteps, type SetupStepKey } from "../setup-card-steps";

const STEP_LABELS: Record<SetupStepKey, string> = {
  connect: "Connect a Calendar",
  second: "Connect a Second Calendar",
  sync: "Choose What Syncs Where",
};

interface SetupCardProps {
  sourceCount: number;
  pairable: boolean;
  syncCount: number;
  usesFeeds: boolean;
}

export function SetupCard({ sourceCount, pairable, syncCount, usesFeeds }: SetupCardProps) {
  const { show, steps } = resolveSetupSteps({ pairable, sourceCount, syncCount, usesFeeds });
  if (!show) return null;

  return (
    <NavigationMenu variant="highlight">
      <NavigationMenuItem>
        <Text size="sm" tone="highlight" className="font-medium">Get Set Up</Text>
      </NavigationMenuItem>
      {steps.map((step) => (
        <NavigationMenuLinkItem key={step.key} to="/dashboard/setup">
          <CheckboxIndicator checked={step.done} variant="highlight" />
          <NavigationMenuItemLabel>
            {STEP_LABELS[step.key]}
            <span className="sr-only">{step.done ? ", done" : ", not done yet"}</span>
          </NavigationMenuItemLabel>
          <NavigationMenuItemTrailing />
        </NavigationMenuLinkItem>
      ))}
    </NavigationMenu>
  );
}
