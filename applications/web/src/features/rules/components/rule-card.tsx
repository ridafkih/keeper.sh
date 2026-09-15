import { preload } from "swr";
import Filter from "lucide-react/dist/esm/icons/filter";
import {
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
  NavigationMenuLinkItem,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { Text } from "@/components/ui/primitives/text";
import { fetcher } from "@/lib/fetcher";
import { pluralize } from "@/lib/pluralize";
import { summarizeRule, type SyncRuleListItem } from "../rules";
import { ruleKey } from "../use-rules";

export function RuleCard({ rule }: { rule: SyncRuleListItem }) {
  return (
    <NavigationMenuLinkItem to={`/dashboard/rules/${rule.id}`} onMouseEnter={() => preload(ruleKey(rule.id), fetcher)}>
      <NavigationMenuItemIcon>
        <Filter size={15} />
      </NavigationMenuItemIcon>
      <NavigationMenuItemLabel className="shrink-0 max-w-[40%]">{rule.name}</NavigationMenuItemLabel>
      <NavigationMenuItemTrailing className="overflow-hidden">
        <Text size="sm" tone="muted" align="right" className="min-w-0 flex-1 truncate">
          {summarizeRule(rule)} · {pluralize(rule.assignmentCount, "pair")}
        </Text>
      </NavigationMenuItemTrailing>
    </NavigationMenuLinkItem>
  );
}
