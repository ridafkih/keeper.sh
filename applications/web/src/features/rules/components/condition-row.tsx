import type { RuleCondition } from "@keeper.sh/data-schemas";
import { NavigationMenuEditableItem } from "@/components/ui/composites/navigation-menu/navigation-menu-editable";
import { CONDITION_LABELS } from "../rules";
import { RowRemoveButton } from "./row-remove-button";
import { RuleRow } from "./rule-row";

interface ConditionRowProps {
  condition: RuleCondition;
  onChange: (condition: RuleCondition) => void;
  onRemove: () => void;
}

export function ConditionRow({ condition, onChange, onRemove }: ConditionRowProps) {
  const remove = <RowRemoveButton label={`Remove ${CONDITION_LABELS[condition.kind]}`} onClick={onRemove} />;

  if (condition.kind === "title_contains") {
    return (
      <NavigationMenuEditableItem
        label={CONDITION_LABELS.title_contains}
        value={condition.value}
        defaultEditing={condition.value === ""}
        trailing={remove}
        onCancel={() => { if (condition.value === "") onRemove(); }}
        onCommit={(value) => onChange({ kind: "title_contains", value })}
      />
    );
  }

  return <RuleRow label={CONDITION_LABELS[condition.kind]} trailing={remove} />;
}
