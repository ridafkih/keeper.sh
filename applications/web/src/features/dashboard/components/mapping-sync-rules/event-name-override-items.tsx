import { NavigationMenuPopover } from "@/components/ui/composites/navigation-menu/navigation-menu-popover";
import { NavigationMenuEditableTemplateItem } from "@/components/ui/composites/navigation-menu/navigation-menu-editable";
import { TemplateText } from "@/components/ui/primitives/template-text";
import { Text } from "@/components/ui/primitives/text";
import type { PatchRuleOverrides } from "@/hooks/use-mapping-sync-rules";
import type { MappingSyncRules } from "@/types/api";
import {
  buildEventNamePatch,
  formatEventNameState,
  formatInherited,
  resolveEventNameChoice,
  resolveReplacementTemplate,
} from "@/utils/mapping-sync-rules";
import type { EventNameChoice } from "@/utils/mapping-sync-rules";
import { OverrideChoiceItem, OverrideTrigger } from "./override-choice-item";

const TEMPLATE_VARIABLES = { calendar_name: "Calendar Name", event_name: "Event Name" };

interface EventNameOverrideItemsProps {
  mapping: MappingSyncRules;
  locked: boolean;
  onPatch: PatchRuleOverrides;
}

export function EventNameOverrideItems({ mapping, locked, onPatch }: EventNameOverrideItemsProps) {
  return (
    <>
      <EventNameChoiceItem mapping={mapping} locked={locked} onPatch={onPatch} />
      {mapping.effectiveRules.excludeEventName && (
        <EventNameReplacementItem mapping={mapping} locked={locked} onPatch={onPatch} />
      )}
    </>
  );
}

function EventNameChoiceItem({ mapping, locked, onPatch }: EventNameOverrideItemsProps) {
  const choice = resolveEventNameChoice(mapping.overrides);
  const inheritedState = formatInherited(formatEventNameState(mapping.sourceRules));
  const inherited = choice === "inherit";

  const choose = (next: EventNameChoice) => {
    if (next !== choice) onPatch(buildEventNamePatch(mapping, next));
  };

  return (
    <NavigationMenuPopover
      disabled={locked}
      trigger={
        <OverrideTrigger
          label="Event Name"
          value={inherited ? inheritedState : formatEventNameState(mapping.effectiveRules)}
          inherited={inherited}
          locked={locked}
        />
      }
    >
      <OverrideChoiceItem label={inheritedState} selected={inherited} onSelect={() => choose("inherit")} />
      <OverrideChoiceItem label="Show Event Name" selected={choice === "show"} onSelect={() => choose("show")} />
      <OverrideChoiceItem label="Replace Event Name" selected={choice === "replace"} onSelect={() => choose("replace")} />
    </NavigationMenuPopover>
  );
}

function EventNameReplacementItem({ mapping, locked, onPatch }: EventNameOverrideItemsProps) {
  const template = resolveReplacementTemplate(mapping.effectiveRules);
  const inherited = mapping.overrides.customEventName === null;

  return (
    <NavigationMenuEditableTemplateItem
      label="Replace Name With"
      disabled={locked}
      value={template}
      renderInput={(live) => <TemplateText template={live} variables={TEMPLATE_VARIABLES} />}
      onCommit={(customEventName) => onPatch({ customEventName })}
    >
      <Text
        size="sm"
        tone={locked || inherited ? "muted" : "default"}
        className="min-w-0 truncate flex-1 text-right"
      >
        <TemplateText template={template} variables={TEMPLATE_VARIABLES} disabled={locked} />
      </Text>
    </NavigationMenuEditableTemplateItem>
  );
}
