import { getExcludableAvailabilities } from "@keeper.sh/data-schemas";
import { NavigationMenuPopover } from "@/components/ui/composites/navigation-menu/navigation-menu-popover";
import type { PatchRuleOverrides } from "@/hooks/use-mapping-sync-rules";
import type { MappingSyncRules } from "@/types/api";
import {
  buildAvailabilityTogglePatch,
  formatExcludedAvailabilities,
  formatInherited,
} from "@/utils/mapping-sync-rules";
import { OverrideChoiceItem, OverrideTrigger } from "./override-choice-item";

interface AvailabilityOverrideItemProps {
  mapping: MappingSyncRules;
  provider: string;
  locked: boolean;
  onPatch: PatchRuleOverrides;
}

export function AvailabilityOverrideItem({ mapping, provider, locked, onPatch }: AvailabilityOverrideItemProps) {
  const options = getExcludableAvailabilities(provider);
  const inherited = mapping.overrides.excludeAvailabilities === null;
  const excluded = mapping.effectiveRules.excludeAvailabilities;
  const inheritedState = formatInherited(
    formatExcludedAvailabilities(options, mapping.sourceRules.excludeAvailabilities),
  );

  return (
    <NavigationMenuPopover
      disabled={locked}
      trigger={
        <OverrideTrigger
          label="Exclude by Status"
          value={inherited ? inheritedState : formatExcludedAvailabilities(options, excluded)}
          inherited={inherited}
          locked={locked}
        />
      }
    >
      <OverrideChoiceItem
        label={inheritedState}
        selected={inherited}
        onSelect={() => {
          if (!inherited) onPatch({ excludeAvailabilities: null });
        }}
      />
      {options.map((option) => (
        <OverrideChoiceItem
          key={option.value}
          label={option.label}
          selected={!inherited && excluded.includes(option.value)}
          keepOpen
          onSelect={() => onPatch(buildAvailabilityTogglePatch(mapping.effectiveRules, option.value))}
        />
      ))}
    </NavigationMenuPopover>
  );
}
