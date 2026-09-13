import ArrowLeftRight from "lucide-react/dist/esm/icons/arrow-left-right";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import Plus from "lucide-react/dist/esm/icons/plus";
import { Button, ButtonText, LinkButton } from "@/components/ui/primitives/button";
import { Text } from "@/components/ui/primitives/text";
import { PremiumHint } from "@/components/ui/primitives/menu-hint";
import {
  NavigationMenu,
  NavigationMenuButtonItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { pluralize } from "@/lib/pluralize";

interface SetupActionsProps {
  canReverse: boolean;
  onReverse: () => void;
  onAddRule: () => void;
  canStart: boolean;
  starting: boolean;
  onStart: () => void;
  onSkip: () => void;
  projected: number;
  limit: number | null;
  overLimit: boolean;
  error: string | null;
}

export function SetupActions({
  canReverse,
  onReverse,
  onAddRule,
  canStart,
  starting,
  onStart,
  onSkip,
  projected,
  limit,
  overLimit,
  error,
}: SetupActionsProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <NavigationMenu>
        <NavigationMenuButtonItem onClick={onReverse} disabled={!canReverse}>
          <NavigationMenuItemIcon>
            <ArrowLeftRight size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>And the other way round</NavigationMenuItemLabel>
        </NavigationMenuButtonItem>
        <NavigationMenuButtonItem onClick={onAddRule}>
          <NavigationMenuItemIcon>
            <Plus size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>Another rule</NavigationMenuItemLabel>
        </NavigationMenuButtonItem>
      </NavigationMenu>
      {limit !== null && (
        <Text size="sm" tone="muted" className="px-0.5">
          {projected} of {pluralize(limit, "sync")} on the free plan.
        </Text>
      )}
      {overLimit && <PremiumHint>Mapping limit reached.</PremiumHint>}
      <Button className="w-full justify-center" disabled={!canStart || starting || overLimit} onClick={onStart}>
        {starting && <LoaderCircle size={16} className="animate-spin" />}
        <ButtonText>Start Syncing</ButtonText>
      </Button>
      <LinkButton to="/dashboard" variant="ghost" className="w-full justify-center" onClick={onSkip}>
        <ButtonText>Skip for Now</ButtonText>
      </LinkButton>
      {error && <Text size="sm" tone="danger" align="center">{error}</Text>}
    </div>
  );
}
