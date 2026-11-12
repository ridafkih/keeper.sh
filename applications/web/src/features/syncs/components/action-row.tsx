import type { RuleAction } from "@keeper.sh/data-schemas";
import { NavigationMenuEditableTemplateItem } from "@/components/ui/composites/navigation-menu/navigation-menu-editable";
import { TemplateText } from "@/components/ui/primitives/template-text";
import { Text } from "@/components/ui/primitives/text";
import { ACTION_LABELS, TEMPLATE_VARIABLES } from "../rule-editing";
import { RowRemoveButton } from "./row-remove-button";
import { RuleRow } from "./rule-row";

interface ActionRowProps {
  action: RuleAction;
  // The variables a Rename To may use; Busy Only leaves out the event's own name.
  variables?: Record<string, string>;
  disabled?: boolean;
  onChange: (action: RuleAction) => void;
  onRemove: () => void;
}

export function ActionRow({ action, variables = TEMPLATE_VARIABLES, disabled, onChange, onRemove }: ActionRowProps) {
  const remove = !disabled && <RowRemoveButton label={`Remove ${ACTION_LABELS[action.kind]}`} onClick={onRemove} />;

  if (action.kind === "rename") {
    return (
      <NavigationMenuEditableTemplateItem
        label={ACTION_LABELS.rename}
        value={action.template}
        defaultEditing={action.template === ""}
        disabled={disabled}
        trailing={remove}
        renderInput={(live) => <TemplateText template={live} variables={variables} />}
        onCancel={() => { if (action.template === "") onRemove(); }}
        onCommit={(template) => onChange({ kind: "rename", template })}
      >
        <Text size="sm" tone="muted" className="min-w-0 flex-1 truncate text-right">
          <TemplateText template={action.template} variables={variables} />
        </Text>
      </NavigationMenuEditableTemplateItem>
    );
  }

  return <RuleRow label={ACTION_LABELS[action.kind]} trailing={remove} />;
}
