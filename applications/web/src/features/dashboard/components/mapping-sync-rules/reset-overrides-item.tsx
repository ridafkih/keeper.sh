import { hasSyncRuleOverrides } from "@keeper.sh/data-schemas";
import {
  NavigationMenu,
  NavigationMenuButtonItem,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { Text } from "@/components/ui/primitives/text";
import type { PatchRuleOverrides } from "@/hooks/use-mapping-sync-rules";
import type { MappingSyncRules } from "@/types/api";
import { RESET_ALL_OVERRIDES_PATCH } from "@/utils/mapping-sync-rules";

interface ResetOverridesMenuProps {
  mapping: MappingSyncRules;
  onPatch: PatchRuleOverrides;
}

export function ResetOverridesMenu({ mapping, onPatch }: ResetOverridesMenuProps) {
  const customized = hasSyncRuleOverrides(mapping.overrides);

  return (
    <NavigationMenu>
      <NavigationMenuButtonItem
        disabled={!customized}
        onClick={() => onPatch(RESET_ALL_OVERRIDES_PATCH)}
      >
        <Text size="sm" tone={customized ? "danger" : "disabled"}>
          Reset to Calendar Defaults
        </Text>
      </NavigationMenuButtonItem>
    </NavigationMenu>
  );
}
