import { NavigationMenuPopover } from "@/components/ui/composites/navigation-menu/navigation-menu-popover";
import type { PatchRuleOverrides } from "@/hooks/use-mapping-sync-rules";
import type { MappingSyncRules } from "@/types/api";
import {
  buildSwitchPatch,
  formatInherited,
  formatSwitchState,
  isSwitchRuleOn,
  resolveSwitchChoice,
} from "@/utils/mapping-sync-rules";
import type { SwitchChoice, SwitchRule } from "@/utils/mapping-sync-rules";
import { OverrideChoiceItem, OverrideTrigger } from "./override-choice-item";

interface SwitchRuleOverrideItemProps {
  rule: SwitchRule;
  mapping: MappingSyncRules;
  locked: boolean;
  onPatch: PatchRuleOverrides;
}

export function SwitchRuleOverrideItem({ rule, mapping, locked, onPatch }: SwitchRuleOverrideItemProps) {
  const choice = resolveSwitchChoice(rule, mapping.overrides);
  const inheritedState = formatInherited(
    formatSwitchState(isSwitchRuleOn(rule, mapping.sourceRules)),
  );
  const effectiveState = formatSwitchState(isSwitchRuleOn(rule, mapping.effectiveRules));
  const inherited = choice === "inherit";

  const choose = (next: SwitchChoice) => {
    if (next !== choice) onPatch(buildSwitchPatch(rule, next));
  };

  return (
    <NavigationMenuPopover
      disabled={locked}
      trigger={
        <OverrideTrigger
          label={rule.label}
          value={inherited ? inheritedState : effectiveState}
          inherited={inherited}
          locked={locked}
        />
      }
    >
      <OverrideChoiceItem label={inheritedState} selected={inherited} onSelect={() => choose("inherit")} />
      <OverrideChoiceItem label="On" selected={choice === "on"} onSelect={() => choose("on")} />
      <OverrideChoiceItem label="Off" selected={choice === "off"} onSelect={() => choose("off")} />
    </NavigationMenuPopover>
  );
}
