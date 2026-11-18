import { NavigationMenuEditableItem } from "@/components/ui/composites/navigation-menu/navigation-menu-editable";
import { NavigationMenuPopover } from "@/components/ui/composites/navigation-menu/navigation-menu-popover";
import type { PatchRuleOverrides } from "@/hooks/use-mapping-sync-rules";
import type { MappingSyncRules } from "@/types/api";
import {
  areTitleKeywordsEqual,
  formatTitleKeywords,
  parseTitleKeywords,
} from "@/utils/calendars";
import {
  buildCustomTitleKeywordsPatch,
  formatExcludedTitleKeywords,
  formatInherited,
} from "@/utils/mapping-sync-rules";
import { OverrideChoiceItem, OverrideTrigger } from "./override-choice-item";

interface TitleKeywordsOverrideItemsProps {
  mapping: MappingSyncRules;
  locked: boolean;
  onPatch: PatchRuleOverrides;
}

export function TitleKeywordsOverrideItems({ mapping, locked, onPatch }: TitleKeywordsOverrideItemsProps) {
  const custom = mapping.overrides.excludeTitleKeywords;

  return (
    <>
      <TitleKeywordsChoiceItem mapping={mapping} locked={locked} onPatch={onPatch} />
      {custom !== null && (
        <NavigationMenuEditableItem
          label="Keywords"
          value={formatTitleKeywords(custom)}
          disabled={locked}
          allowEmpty
          onCommit={(value) => {
            const excludeTitleKeywords = parseTitleKeywords(value);
            if (!areTitleKeywordsEqual(excludeTitleKeywords, custom)) {
              onPatch({ excludeTitleKeywords });
            }
          }}
        />
      )}
    </>
  );
}

function TitleKeywordsChoiceItem({ mapping, locked, onPatch }: TitleKeywordsOverrideItemsProps) {
  const inherited = mapping.overrides.excludeTitleKeywords === null;
  const inheritedState = formatInherited(
    formatExcludedTitleKeywords(mapping.sourceRules.excludeTitleKeywords),
  );

  return (
    <NavigationMenuPopover
      disabled={locked}
      trigger={
        <OverrideTrigger
          label="Exclude Titles Containing"
          value={inherited ? inheritedState : "Custom"}
          inherited={inherited}
          locked={locked}
        />
      }
    >
      <OverrideChoiceItem
        label={inheritedState}
        selected={inherited}
        onSelect={() => {
          if (!inherited) onPatch({ excludeTitleKeywords: null });
        }}
      />
      <OverrideChoiceItem
        label="Custom Keywords"
        selected={!inherited}
        onSelect={() => {
          if (inherited) onPatch(buildCustomTitleKeywordsPatch(mapping.effectiveRules));
        }}
      />
    </NavigationMenuPopover>
  );
}
