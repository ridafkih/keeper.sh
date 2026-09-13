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
  rules: "Choose What Syncs Where",
  second: "Connect a Second Calendar",
};

interface SetupCardProps {
  sourceCount: number;
  accountCount: number;
  mappingCount: number;
}

export function SetupCard({ sourceCount, accountCount, mappingCount }: SetupCardProps) {
  const { show, steps } = resolveSetupSteps({ accountCount, mappingCount, sourceCount });
  if (!show) return null;

  return (
    <NavigationMenu variant="highlight">
      <NavigationMenuItem>
        <Text size="sm" tone="highlight" className="font-medium">Get Set Up</Text>
      </NavigationMenuItem>
      {steps.map((step) => (
        <NavigationMenuLinkItem key={step.key} to="/dashboard/setup">
          <CheckboxIndicator checked={step.done} variant="highlight" />
          <NavigationMenuItemLabel>{STEP_LABELS[step.key]}</NavigationMenuItemLabel>
          <NavigationMenuItemTrailing />
        </NavigationMenuLinkItem>
      ))}
    </NavigationMenu>
  );
}
