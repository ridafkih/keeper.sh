import type { RuleAction } from "@keeper.sh/data-schemas";
import { NavigationMenuEditableTemplateItem } from "@/components/ui/composites/navigation-menu/navigation-menu-editable";
import { TemplateText } from "@/components/ui/primitives/template-text";
import { Text } from "@/components/ui/primitives/text";
import { ACTION_LABELS, TEMPLATE_VARIABLES } from "../rules";
import { RowRemoveButton } from "./row-remove-button";
import { RuleRow } from "./rule-row";

interface ActionRowProps {
  action: RuleAction;
  onChange: (action: RuleAction) => void;
  onRemove: () => void;
}

export function ActionRow({ action, onChange, onRemove }: ActionRowProps) {
  const remove = <RowRemoveButton label={`Remove ${ACTION_LABELS[action.kind]}`} onClick={onRemove} />;

  if (action.kind === "rename") {
    return (
      <NavigationMenuEditableTemplateItem
        label={ACTION_LABELS.rename}
        value={action.template}
        defaultEditing={action.template === ""}
        trailing={remove}
        renderInput={(live) => <TemplateText template={live} variables={TEMPLATE_VARIABLES} />}
        onCancel={() => { if (action.template === "") onRemove(); }}
        onCommit={(template) => onChange({ kind: "rename", template })}
      >
        <Text size="sm" tone="muted" className="min-w-0 flex-1 truncate text-right">
          <TemplateText template={action.template} variables={TEMPLATE_VARIABLES} />
        </Text>
      </NavigationMenuEditableTemplateItem>
    );
  }

  return <RuleRow label={ACTION_LABELS[action.kind]} trailing={remove} />;
}
