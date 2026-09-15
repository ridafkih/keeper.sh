import CheckIcon from "lucide-react/dist/esm/icons/check";
import Plus from "lucide-react/dist/esm/icons/plus";
import type { SyncRule } from "@keeper.sh/data-schemas";
import { PremiumHint } from "@/components/ui/primitives/menu-hint";
import { Text } from "@/components/ui/primitives/text";
import {
  NavigationMenu,
  NavigationMenuButtonItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { summarizeRule } from "../rules";

interface RuleOptionsProps {
  rules: SyncRule[];
  selectedId: string | null;
  canCreate: boolean;
  onSelect: (ruleId: string) => void;
  onCreate: () => void;
}

export function RuleOptions({ rules, selectedId, canCreate, onSelect, onCreate }: RuleOptionsProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <NavigationMenu>
        {rules.map((rule) => (
          <NavigationMenuButtonItem key={rule.id} onClick={() => onSelect(rule.id)}>
            <NavigationMenuItemLabel className="shrink-0 max-w-[45%]">{rule.name}</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing className="overflow-hidden">
              <Text size="sm" tone="muted" align="right" className="min-w-0 flex-1 truncate">{summarizeRule(rule)}</Text>
              {rule.id === selectedId && <CheckIcon size={14} className="shrink-0 text-foreground" />}
            </NavigationMenuItemTrailing>
          </NavigationMenuButtonItem>
        ))}
        <NavigationMenuButtonItem disabled={!canCreate} onClick={onCreate}>
          <NavigationMenuItemIcon>
            <Plus size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>New Rule…</NavigationMenuItemLabel>
        </NavigationMenuButtonItem>
      </NavigationMenu>
      {!canCreate && <PremiumHint>Free plans include one rule.</PremiumHint>}
    </div>
  );
}
