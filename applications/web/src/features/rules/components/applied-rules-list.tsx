import { use } from "react";
import { preload } from "swr";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import X from "lucide-react/dist/esm/icons/x";
import { Link } from "@tanstack/react-router";
import type { SyncRule } from "@keeper.sh/data-schemas";
import { MenuVariantContext } from "@/components/ui/composites/navigation-menu/navigation-menu.contexts";
import { navigationMenuItemStyle } from "@/components/ui/composites/navigation-menu/navigation-menu.styles";
import {
  NavigationMenu,
  NavigationMenuEmptyItem,
  NavigationMenuItemLabel,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { Text } from "@/components/ui/primitives/text";
import { fetcher } from "@/lib/fetcher";
import { summarizeRule } from "../rules";
import { ruleKey } from "../use-rules";
import { RowIconButton } from "./row-remove-button";

interface AppliedRulesListProps {
  rules: SyncRule[];
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
}

export function AppliedRulesList({ rules, onMove, onRemove }: AppliedRulesListProps) {
  return (
    <NavigationMenu>
      {rules.length === 0 && (
        <NavigationMenuEmptyItem>No rules applied — nothing is copied yet</NavigationMenuEmptyItem>
      )}
      {rules.map((rule, index) => (
        <AppliedRuleRow
          key={rule.id}
          rule={rule}
          first={index === 0}
          last={index === rules.length - 1}
          onMoveUp={() => onMove(index, -1)}
          onMoveDown={() => onMove(index, 1)}
          onRemove={() => onRemove(index)}
        />
      ))}
    </NavigationMenu>
  );
}

function AppliedRuleRow({
  rule,
  first,
  last,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  rule: SyncRule;
  first: boolean;
  last: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const variant = use(MenuVariantContext);

  return (
    <li className="flex items-center">
      <Link
        to="/dashboard/rules/$ruleId"
        params={{ ruleId: rule.id }}
        draggable="false"
        onMouseEnter={() => preload(ruleKey(rule.id), fetcher)}
        className={navigationMenuItemStyle({ variant, className: "min-w-0 flex-1" })}
      >
        <NavigationMenuItemLabel className="shrink-0 max-w-[45%]">{rule.name}</NavigationMenuItemLabel>
        <Text size="sm" tone="muted" align="right" className="min-w-0 flex-1 truncate">{summarizeRule(rule)}</Text>
      </Link>
      <div className="mr-1.5 flex shrink-0 items-center">
        <RowIconButton label={`Move ${rule.name} up`} disabled={first} onClick={onMoveUp}>
          <ChevronUp size={14} />
        </RowIconButton>
        <RowIconButton label={`Move ${rule.name} down`} disabled={last} onClick={onMoveDown}>
          <ChevronDown size={14} />
        </RowIconButton>
        <RowIconButton label={`Remove ${rule.name}`} onClick={onRemove}>
          <X size={14} />
        </RowIconButton>
      </div>
    </li>
  );
}
