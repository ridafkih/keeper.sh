import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSWRConfig } from "swr";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import Plus from "lucide-react/dist/esm/icons/plus";
import { syncRuleNameSchema } from "@keeper.sh/data-schemas";
import type { RuleAction, RuleCondition } from "@keeper.sh/data-schemas";
import { BackButton } from "@/components/ui/primitives/back-button";
import { DashboardHeading1, DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { DeleteConfirmation } from "@/components/ui/primitives/delete-confirmation";
import { PremiumGate } from "@/components/ui/primitives/menu-hint";
import { PageBody } from "@/components/ui/primitives/page-body";
import { StickyPageHeader } from "@/components/ui/primitives/sticky-page-header";
import { Text } from "@/components/ui/primitives/text";
import { RouteShell } from "@/components/ui/shells/route-shell";
import {
  NavigationMenu,
  NavigationMenuButtonItem,
  NavigationMenuEmptyItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { NavigationMenuEditableItem } from "@/components/ui/composites/navigation-menu/navigation-menu-editable";
import { NavigationMenuPopover } from "@/components/ui/composites/navigation-menu/navigation-menu-popover";
import { usePopover } from "@/components/ui/composites/navigation-menu/navigation-menu.contexts";
import { useEntitlements, useMutateEntitlements } from "@/hooks/use-entitlements";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { resolveErrorMessage } from "@/utils/errors";
import {
  ACTION_LABELS,
  CONDITION_LABELS,
  availableActionKinds,
  availableConditionKinds,
  createAction,
  createCondition,
  needsInput,
  normalizeActions,
  removeAt,
  replaceAt,
  splitPairsByAssignment,
  summarizeRule,
  type ActionKind,
  type CalendarPair,
  type ConditionKind,
  type SyncRuleDetail,
} from "@/features/rules/rules";
import { deleteRule, patchRule, RULES_KEY, useRule, type RulePatch } from "@/features/rules/use-rules";
import { assignRuleToPair, unassignRuleFromPair } from "@/features/rules/use-pair-rules";
import { usePairs } from "@/features/rules/use-pairs";
import { ActionRow } from "@/features/rules/components/action-row";
import { AddRuleItem } from "@/features/rules/components/add-rule-item";
import { ConditionRow } from "@/features/rules/components/condition-row";
import { PairButtonRow, PairRow } from "@/features/rules/components/pair-row";
import { RowRemoveButton } from "@/features/rules/components/row-remove-button";

export const Route = createFileRoute("/(dashboard)/dashboard/rules/$ruleId")({
  component: RuleEditorPage,
});

type Pending = { kind: "condition"; item: RuleCondition } | { kind: "action"; item: RuleAction } | null;

function RuleEditorPage() {
  const { ruleId } = Route.useParams();
  const navigate = useNavigate();
  const { mutate: globalMutate } = useSWRConfig();
  const { data: entitlements } = useEntitlements();
  const { revalidateEntitlements } = useMutateEntitlements();
  const { data: rule, error, mutate } = useRule(ruleId);
  const { groups } = usePairs();
  const [pending, setPending] = useState<Pending>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (error) return <RouteShell backFallback="/dashboard/rules" status="error" onRetry={() => { void mutate(); }} />;
  if (!rule) return <RouteShell backFallback="/dashboard/rules" status="loading" />;

  const locked = Boolean(entitlements && !entitlements.canUseEventFilters);

  const patch = (changes: RulePatch, field: string) => {
    track(ANALYTICS_EVENTS.rule_updated, { field });
    setMutationError(null);
    mutate({ ...rule, ...changes }, { revalidate: false });
    patchRule(
      ruleId,
      changes,
      (patchError) => {
        setMutationError(resolveErrorMessage(patchError, "Failed to update this rule."));
        void mutate();
      },
      () => { void globalMutate(RULES_KEY); },
    );
  };

  const rename = (name: string) => {
    if (!syncRuleNameSchema.allows(name)) {
      setMutationError("Rule name cannot be empty.");
      return;
    }
    patch({ name }, "name");
  };

  const setConditions = (conditions: RuleCondition[]) => patch({ conditions }, "conditions");
  const setActions = (actions: RuleAction[]) => patch({ actions: normalizeActions(actions) }, "actions");

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

  const handleDelete = async () => {
    setDeleting(true);
    setMutationError(null);
    try {
      await deleteRule(ruleId);
      track(ANALYTICS_EVENTS.rule_deleted);
      await Promise.all([globalMutate(RULES_KEY), revalidateEntitlements()]);
      await navigate({ to: "/dashboard/rules" });
    } catch (deleteError) {
      setMutationError(resolveErrorMessage(deleteError, "Failed to delete this rule."));
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  const refreshAssignments = () => Promise.all([mutate(), globalMutate(RULES_KEY)]);

  const assign = async (pair: CalendarPair) => {
    setMutationError(null);
    try {
      await assignRuleToPair(pair.source.id, pair.destination.id, ruleId);
      track(ANALYTICS_EVENTS.rule_assigned, { source: "editor" });
      await refreshAssignments();
    } catch (assignError) {
      setMutationError(resolveErrorMessage(assignError, "Failed to apply this rule."));
    }
  };

  const unassign = async (pair: CalendarPair) => {
    setMutationError(null);
    try {
      await unassignRuleFromPair(pair.source.id, pair.destination.id, ruleId);
      track(ANALYTICS_EVENTS.rule_unassigned);
      await refreshAssignments();
    } catch (unassignError) {
      setMutationError(resolveErrorMessage(unassignError, "Failed to remove this rule from the pair."));
    }
  };

  const conditionOptions = availableConditionKinds(rule.conditions).map((kind) => ({ kind, label: CONDITION_LABELS[kind] }));
  const actionOptions = availableActionKinds(rule.actions).map((kind) => ({ kind, label: ACTION_LABELS[kind] }));
  const { assigned, unassigned } = splitPairsByAssignment(groups ?? [], rule.assignments);

  return (
    <div className="flex flex-col gap-1.5 lg:h-full">
      <StickyPageHeader className="gap-1.5">
        <BackButton fallback="/dashboard/rules" />
        <RuleHeader rule={rule} />
      </StickyPageHeader>
      <PageBody className="gap-1.5">
        {mutationError && <Text size="sm" tone="danger">{mutationError}</Text>}
        <DashboardSection title="Rule Name" description="Click below to rename this rule. Only you can see this name." />
        <NavigationMenu>
          <NavigationMenuEditableItem value={rule.name} onCommit={rename} />
        </NavigationMenu>
        <DashboardSection
          title="When an Event"
          description="All of these must be true for the rule to apply. With no conditions, it applies to every event."
        />
        <PremiumGate locked={locked} hint="Custom rules are a Pro feature.">
          <NavigationMenu>
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
            <AddRuleItem label="Add a Condition" options={conditionOptions} disabled={locked || pending !== null} onAdd={addCondition} />
          </NavigationMenu>
        </PremiumGate>
        <DashboardSection
          title="Then"
          description={<>What happens to a matching event&apos;s copy. Use <Text as="span" size="sm" className="text-template inline">{"{{calendar_name}}"}</Text> or <Text as="span" size="sm" className="text-template inline">{"{{event_name}}"}</Text> in a new name.</>}
        />
        <PremiumGate locked={locked} hint="Custom rules are a Pro feature.">
          <NavigationMenu>
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
            <AddRuleItem label="Add an Action" options={actionOptions} disabled={locked || pending !== null} onAdd={addAction} />
          </NavigationMenu>
        </PremiumGate>
        <DashboardSection title="Applies To" description="Calendar pairs that check this rule. Open a pair to change the order its rules run in." />
        <NavigationMenu>
          {assigned.length === 0 && <NavigationMenuEmptyItem>Not applied to any pair yet</NavigationMenuEmptyItem>}
          {assigned.map((pair) => (
            <AssignedPairRow key={`${pair.source.id}-${pair.destination.id}`} pair={pair} onRemove={() => void unassign(pair)} />
          ))}
          <AddCalendarsItem pairs={unassigned} onAdd={(pair) => void assign(pair)} />
        </NavigationMenu>
        {rule.isDefault && (
          <Text size="sm" tone="muted" className="px-0.5">
            Your default rule cannot be deleted. New pairs start with it.
          </Text>
        )}
        {!rule.isDefault && (
          <>
            <NavigationMenu>
              <NavigationMenuButtonItem onClick={() => setDeleteOpen(true)}>
                <NavigationMenuItemIcon>
                  <Trash2 size={15} className="text-destructive" />
                </NavigationMenuItemIcon>
                <Text size="sm" tone="danger">Delete Rule</Text>
              </NavigationMenuButtonItem>
            </NavigationMenu>
            <DeleteConfirmation
              title="Delete rule?"
              description={`This permanently removes "${rule.name}". Pairs using it keep their other rules. A pair left with no rules copies nothing.`}
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
              deleting={deleting}
              onConfirm={() => void handleDelete()}
            />
          </>
        )}
      </PageBody>
    </div>
  );
}

function RuleHeader({ rule }: { rule: SyncRuleDetail }) {
  return (
    <div className="flex flex-col px-0.5 pt-4">
      <DashboardHeading1 className="select-none">{rule.name}</DashboardHeading1>
      <Text size="sm" tone="muted" className="truncate">{summarizeRule(rule)}</Text>
    </div>
  );
}

function AssignedPairRow({ pair, onRemove }: { pair: CalendarPair; onRemove: () => void }) {
  return (
    <li className="flex items-center">
      <ul className="contents">
        <PairRow pair={pair} />
      </ul>
      <RowRemoveButton label={`Remove from ${pair.source.name} → ${pair.destination.name}`} onClick={onRemove} />
    </li>
  );
}

function AddCalendarsItem({ pairs, onAdd }: { pairs: CalendarPair[]; onAdd: (pair: CalendarPair) => void }) {
  return (
    <NavigationMenuPopover
      disabled={pairs.length === 0}
      trigger={
        <>
          <NavigationMenuItemIcon>
            <Plus size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>Add Calendars</NavigationMenuItemLabel>
        </>
      }
    >
      {pairs.map((pair) => (
        <AddCalendarsOption key={`${pair.source.id}-${pair.destination.id}`} pair={pair} onAdd={onAdd} />
      ))}
    </NavigationMenuPopover>
  );
}

function AddCalendarsOption({ pair, onAdd }: { pair: CalendarPair; onAdd: (pair: CalendarPair) => void }) {
  const { close } = usePopover();
  return <PairButtonRow pair={pair} onClick={() => { onAdd(pair); close(); }} />;
}
