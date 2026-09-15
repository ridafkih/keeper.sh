import Plus from "lucide-react/dist/esm/icons/plus";
import type { SyncRule } from "@keeper.sh/data-schemas";
import { usePopover } from "@/components/ui/composites/navigation-menu/navigation-menu.contexts";
import {
  NavigationMenuButtonItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { NavigationMenuPopover } from "@/components/ui/composites/navigation-menu/navigation-menu-popover";
import { Text } from "@/components/ui/primitives/text";
import { summarizeRule } from "../rules";

interface ApplyRuleItemProps {
  rules: SyncRule[];
  canCreate: boolean;
  onApply: (ruleId: string) => void;
  onCreate: () => void;
}

/** Offers the rules a pair does not check yet, plus a way to start a new one. */
export function ApplyRuleItem({ rules, canCreate, onApply, onCreate }: ApplyRuleItemProps) {
  return (
    <NavigationMenuPopover
      trigger={
        <>
          <NavigationMenuItemIcon>
            <Plus size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>Apply a Rule</NavigationMenuItemLabel>
        </>
      }
    >
      {rules.map((rule) => (
        <ApplyRuleOption key={rule.id} rule={rule} onApply={onApply} />
      ))}
      <CreateRuleOption canCreate={canCreate} onCreate={onCreate} />
    </NavigationMenuPopover>
  );
}

function ApplyRuleOption({ rule, onApply }: { rule: SyncRule; onApply: (ruleId: string) => void }) {
  const { close } = usePopover();

  return (
    <NavigationMenuButtonItem onClick={() => { onApply(rule.id); close(); }}>
      <NavigationMenuItemLabel className="shrink-0 max-w-[45%]">{rule.name}</NavigationMenuItemLabel>
      <NavigationMenuItemTrailing className="overflow-hidden">
        <Text size="sm" tone="muted" align="right" className="min-w-0 flex-1 truncate">{summarizeRule(rule)}</Text>
      </NavigationMenuItemTrailing>
    </NavigationMenuButtonItem>
  );
}

function CreateRuleOption({ canCreate, onCreate }: { canCreate: boolean; onCreate: () => void }) {
  const { close } = usePopover();

  return (
    <NavigationMenuButtonItem disabled={!canCreate} onClick={() => { onCreate(); close(); }}>
      <NavigationMenuItemIcon>
        <Plus size={15} />
      </NavigationMenuItemIcon>
      <NavigationMenuItemLabel>New Rule…</NavigationMenuItemLabel>
    </NavigationMenuButtonItem>
  );
}
