import { useState } from "react";
import ArrowDown from "lucide-react/dist/esm/icons/arrow-down";
import ArrowUp from "lucide-react/dist/esm/icons/arrow-up";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import Copy from "lucide-react/dist/esm/icons/copy";
import LockIcon from "lucide-react/dist/esm/icons/lock";
import Plus from "lucide-react/dist/esm/icons/plus";
import SlidersHorizontal from "lucide-react/dist/esm/icons/sliders-horizontal";
import X from "lucide-react/dist/esm/icons/x";
import { MAX_ADVANCED_RULES, syncRuleNameSchema } from "@keeper.sh/data-schemas";
import type { AdvancedRule, RuleAction, RuleCondition, ShareAs, SyncSummary } from "@keeper.sh/data-schemas";
import { AnimatedReveal, RevealGroup, RevealItem } from "@/components/ui/primitives/animated-reveal";
import { PremiumGate } from "@/components/ui/primitives/menu-hint";
import { SegmentedControl } from "@/components/ui/primitives/segmented-control";
import { Text } from "@/components/ui/primitives/text";
import {
  NavigationMenu,
  NavigationMenuButtonItem,
  NavigationMenuItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { NavigationMenuEditableItem } from "@/components/ui/composites/navigation-menu/navigation-menu-editable";
import { NavigationMenuPopover } from "@/components/ui/composites/navigation-menu/navigation-menu-popover";
import { usePopover } from "@/components/ui/composites/navigation-menu/navigation-menu.contexts";
import { cn } from "@/utils/cn";
import {
  ACTION_LABELS,
  CONDITION_LABELS,
  availableActionKinds,
  availableConditionKinds,
  createAction,
  createCondition,
  moveItem,
  needsInput,
  normalizeActions,
  removeAt,
  replaceAt,
  type ActionKind,
  type ConditionKind,
} from "../rule-editing";
import { shareAsLabel } from "../syncs";
import { ActionRow } from "./action-row";
import { AddRuleItem } from "./add-rule-item";
import { ConditionRow } from "./condition-row";
import { RowIconButton } from "./row-remove-button";

interface AdvancedRulesProps {
  rules: AdvancedRule[];
  shareAs: ShareAs;
  locked: boolean;
  otherSyncs: SyncSummary[];
  onChange: (rules: AdvancedRule[]) => void;
}

const createRule = (): AdvancedRule => ({
  actions: [],
  conditions: [],
  id: crypto.randomUUID(),
  match: "all",
  name: "New rule",
});

export function AdvancedRules({ rules, shareAs, locked, otherSyncs, onChange }: AdvancedRulesProps) {
  const [open, setOpen] = useState(rules.length > 0);
  const donors = otherSyncs.filter((sync) => sync.rules.length > 0);
  const copyFrom = (sync: SyncSummary) => {
    const copies = sync.rules.map((rule) => ({ ...rule, id: crypto.randomUUID() }));
    onChange([...rules, ...copies].slice(0, MAX_ADVANCED_RULES));
  };

  return (
    <>
      <NavigationMenu>
        <NavigationMenuButtonItem onClick={() => setOpen((current) => !current)}>
          <NavigationMenuItemIcon>
            <SlidersHorizontal size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>Advanced Rules</NavigationMenuItemLabel>
          <NavigationMenuItemTrailing indicator={<ChevronDown size={15} className={cn("shrink-0 text-foreground-muted transition-transform", open && "rotate-180")} />}>
            <Text size="sm" tone="muted">{rules.length === 0 ? "None" : rules.length === 1 ? "1 rule" : `${rules.length} rules`}</Text>
          </NavigationMenuItemTrailing>
        </NavigationMenuButtonItem>
      </NavigationMenu>
      <AnimatedReveal show={open} skipInitial>
        <div className="flex flex-col gap-1.5 pt-1.5">
          <Text size="sm" tone="muted" className="px-0.5">
            Checked after Never Copy; first match wins. Anything no rule matches is shared as {shareAsLabel(shareAs)}.
          </Text>
          <PremiumGate locked={locked} hint="Advanced rules are a Pro feature.">
            <div className="flex flex-col">
              {/* Spacing sits inside each card rather than in a gap, so a card collapsing away takes it along. */}
              <RevealGroup>
                {rules.map((rule, index) => (
                  <RevealItem key={rule.id}>
                    <div className="pb-1.5">
                      <RuleCard
                        rule={rule}
                        isFirst={index === 0}
                        isLast={index === rules.length - 1}
                        onChange={(next) => onChange(replaceAt(rules, index, next))}
                        onMove={(offset) => onChange(moveItem(rules, index, index + offset))}
                        onRemove={() => onChange(removeAt(rules, index))}
                      />
                    </div>
                  </RevealItem>
                ))}
              </RevealGroup>
              <div className="flex flex-col gap-1.5">
                <NavigationMenu className="border-dashed shadow-none">
                  <NavigationMenuItem>
                    <NavigationMenuItemIcon>
                      <LockIcon size={15} />
                    </NavigationMenuItemIcon>
                    <NavigationMenuItemLabel>Everything Else</NavigationMenuItemLabel>
                    <NavigationMenuItemTrailing indicator={null}>
                      <Text size="sm" tone="muted">Share As {shareAsLabel(shareAs)}</Text>
                    </NavigationMenuItemTrailing>
                  </NavigationMenuItem>
                </NavigationMenu>
                <NavigationMenu>
                  <NavigationMenuButtonItem disabled={rules.length >= MAX_ADVANCED_RULES} onClick={() => onChange([...rules, createRule()])}>
                    <NavigationMenuItemIcon>
                      <Plus size={15} />
                    </NavigationMenuItemIcon>
                    <NavigationMenuItemLabel>Add a Rule</NavigationMenuItemLabel>
                  </NavigationMenuButtonItem>
                  {donors.length > 0 && (
                    <NavigationMenuPopover
                      trigger={(
                        <>
                          <NavigationMenuItemIcon>
                            <Copy size={15} />
                          </NavigationMenuItemIcon>
                          <NavigationMenuItemLabel>Copy Rules From…</NavigationMenuItemLabel>
                        </>
                      )}
                    >
                      {donors.map((sync) => (
                        <CopyRulesOption key={sync.id} sync={sync} onCopy={copyFrom} />
                      ))}
                    </NavigationMenuPopover>
                  )}
                </NavigationMenu>
              </div>
            </div>
          </PremiumGate>
        </div>
      </AnimatedReveal>
    </>
  );
}

function CopyRulesOption({ sync, onCopy }: { sync: SyncSummary; onCopy: (sync: SyncSummary) => void }) {
  const { close } = usePopover();
  return (
    <NavigationMenuButtonItem onClick={() => { onCopy(sync); close(); }}>
      <NavigationMenuItemLabel>{sync.name}</NavigationMenuItemLabel>
      <NavigationMenuItemTrailing indicator={null}>
        <Text size="sm" tone="muted">{sync.rules.length === 1 ? "1 rule" : `${sync.rules.length} rules`}</Text>
      </NavigationMenuItemTrailing>
    </NavigationMenuButtonItem>
  );
}

type Pending = { kind: "condition"; item: RuleCondition } | { kind: "action"; item: RuleAction } | null;

interface RuleCardProps {
  rule: AdvancedRule;
  isFirst: boolean;
  isLast: boolean;
  onChange: (rule: AdvancedRule) => void;
  onMove: (offset: number) => void;
  onRemove: () => void;
}

function RuleCard({ rule, isFirst, isLast, onChange, onMove, onRemove }: RuleCardProps) {
  const [pending, setPending] = useState<Pending>(null);
  const setConditions = (conditions: RuleCondition[]) => onChange({ ...rule, conditions });
  const setActions = (actions: RuleAction[]) => onChange({ ...rule, actions: normalizeActions(actions) });

  const addCondition = (kind: ConditionKind) => {
    const condition = createCondition(kind);
    if (needsInput(condition)) {
      setPending({ item: condition, kind: "condition" });
      return;
    }
    setConditions([...rule.conditions, condition]);
  };

  const addAction = (kind: ActionKind) => {
    const action = createAction(kind);
    if (needsInput(action)) {
      setPending({ item: action, kind: "action" });
      return;
    }
    setActions([...rule.actions, action]);
  };

  const rename = (name: string) => {
    if (syncRuleNameSchema.allows(name)) onChange({ ...rule, name });
  };

  return (
    <div className="-mx-1 flex flex-col gap-1 rounded-[1.25rem] border border-border-elevated p-1">
      <ul className="flex flex-col p-0.5">
        <NavigationMenuEditableItem
          value={rule.name}
          onCommit={rename}
          trailing={(
            <div className="mr-2 flex shrink-0 items-center">
              <RowIconButton label="Move rule up" disabled={isFirst} onClick={() => onMove(-1)}>
                <ArrowUp size={14} />
              </RowIconButton>
              <RowIconButton label="Move rule down" disabled={isLast} onClick={() => onMove(1)}>
                <ArrowDown size={14} />
              </RowIconButton>
              <RowIconButton label={`Remove ${rule.name}`} onClick={onRemove}>
                <X size={14} />
              </RowIconButton>
            </div>
          )}
        />
      </ul>
      <NavigationMenu>
        <NavigationMenuItem className="flex-wrap gap-2">
          <Text size="sm" tone="muted">When an event matches</Text>
          <SegmentedControl
            label="Match"
            value={rule.match}
            options={[{ label: "All", value: "all" }, { label: "Any", value: "any" }]}
            onChange={(match) => onChange({ ...rule, match })}
          />
          <Text size="sm" tone="muted">of these</Text>
        </NavigationMenuItem>
        {rule.conditions.map((condition, index) => (
          <ConditionRow
            key={`${condition.kind}-${index}`}
            condition={condition}
            onChange={(next) => setConditions(replaceAt(rule.conditions, index, next))}
            onRemove={() => setConditions(removeAt(rule.conditions, index))}
          />
        ))}
        {pending?.kind === "condition" && (
          <ConditionRow
            condition={pending.item}
            onChange={(next) => { setPending(null); setConditions([...rule.conditions, next]); }}
            onRemove={() => setPending(null)}
          />
        )}
        <AddRuleItem
          label="Add a Condition"
          options={availableConditionKinds(rule).map((kind) => ({ kind, label: CONDITION_LABELS[kind] }))}
          disabled={pending !== null}
          onAdd={addCondition}
        />
      </NavigationMenu>
      <NavigationMenu>
        <NavigationMenuItem>
          <Text size="sm" tone="muted">Then</Text>
        </NavigationMenuItem>
        {rule.actions.map((action, index) => (
          <ActionRow
            key={`${action.kind}-${index}`}
            action={action}
            onChange={(next) => setActions(replaceAt(rule.actions, index, next))}
            onRemove={() => setActions(removeAt(rule.actions, index))}
          />
        ))}
        {pending?.kind === "action" && (
          <ActionRow
            action={pending.item}
            onChange={(next) => { setPending(null); setActions([...rule.actions, next]); }}
            onRemove={() => setPending(null)}
          />
        )}
        <AddRuleItem
          label="Add an Action"
          options={availableActionKinds(rule.actions).map((kind) => ({ kind, label: ACTION_LABELS[kind] }))}
          disabled={pending !== null}
          onAdd={addAction}
        />
      </NavigationMenu>
    </div>
  );
}
