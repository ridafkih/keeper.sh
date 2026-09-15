import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right";
import { BackButton } from "@/components/ui/primitives/back-button";
import { DashboardHeading1, DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { PageBody } from "@/components/ui/primitives/page-body";
import { ProviderIcon } from "@/components/ui/primitives/provider-icon";
import { StickyPageHeader } from "@/components/ui/primitives/sticky-page-header";
import { Text } from "@/components/ui/primitives/text";
import { RouteShell } from "@/components/ui/shells/route-shell";
import {
  NavigationMenu,
  NavigationMenuEmptyItem,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { MetadataRow } from "@/features/dashboard/components/metadata-row";
import { canAddMore, useEntitlements } from "@/hooks/use-entitlements";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { resolveErrorMessage } from "@/utils/errors";
import {
  calendarPagePath,
  findPair,
  flattenPairs,
  moveItem,
  removeAt,
  resolveAppliedRules,
  resolveUnappliedRules,
  type CalendarPair,
} from "@/features/rules/rules";
import { useRules } from "@/features/rules/use-rules";
import { usePairRules } from "@/features/rules/use-pair-rules";
import { usePairs } from "@/features/rules/use-pairs";
import { AppliedRulesList } from "@/features/rules/components/applied-rules-list";
import { ApplyRuleItem } from "@/features/rules/components/apply-rule-item";
import { CreateRuleModal } from "@/features/rules/components/create-rule-modal";
import { PairRow } from "@/features/rules/components/pair-row";

export const Route = createFileRoute("/(dashboard)/dashboard/rules/pairs/$sourceId/$destinationId")({
  component: PairPage,
});

function PairPage() {
  const { sourceId, destinationId } = Route.useParams();
  const navigate = useNavigate();
  const { data: entitlements } = useEntitlements();
  const { data: rules, error: rulesError, mutate: mutateRules } = useRules();
  const { groups, error: pairsError, mutate: mutatePairs } = usePairs();
  const { data: pairRules, error: pairError, mutate: mutatePairRules, setRuleIds } = usePairRules(sourceId, destinationId);
  const [createOpen, setCreateOpen] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  if (rulesError || pairsError || pairError) {
    return (
      <RouteShell
        backFallback="/dashboard/rules"
        status="error"
        onRetry={() => { void mutateRules(); void mutatePairs(); void mutatePairRules(); }}
      />
    );
  }
  if (!rules || !groups || !pairRules) return <RouteShell backFallback="/dashboard/rules" status="loading" />;

  const pair = findPair(groups, sourceId, destinationId);
  if (!pair) return <RouteShell backFallback="/dashboard/rules" status="error" onRetry={() => { void mutatePairs(); }} />;

  const applied = resolveAppliedRules(pairRules.ruleIds, rules);
  const unapplied = resolveUnappliedRules(pairRules.ruleIds, rules);
  const otherPairs = flattenPairs(groups).filter(
    (candidate) => candidate.source.id !== sourceId || candidate.destination.id !== destinationId,
  );

  const write = (ruleIds: string[], event: string, properties?: Record<string, string>) => {
    track(event, properties);
    setMutationError(null);
    setRuleIds(ruleIds, (writeError) => {
      setMutationError(resolveErrorMessage(writeError, "Failed to update this pair's rules."));
    });
  };

  return (
    <div className="flex flex-col gap-1.5 lg:h-full">
      <StickyPageHeader className="gap-1.5">
        <BackButton fallback="/dashboard/rules" />
        <PairHeader pair={pair} />
      </StickyPageHeader>
      <PageBody className="gap-1.5">
        {mutationError && <Text size="sm" tone="danger">{mutationError}</Text>}
        <DashboardSection
          title="Applied Rules"
          description="Checked top to bottom. The first rule that matches an event decides what happens to it. Events no rule matches are not copied."
        />
        <AppliedRulesList
          rules={applied}
          onMove={(index, direction) => write(moveItem(pairRules.ruleIds, index, index + direction), ANALYTICS_EVENTS.rule_reordered)}
          onRemove={(index) => write(removeAt(pairRules.ruleIds, index), ANALYTICS_EVENTS.rule_unassigned)}
        />
        <NavigationMenu>
          <ApplyRuleItem
            rules={unapplied}
            canCreate={canAddMore(entitlements?.rules)}
            onApply={(ruleId) => write([...pairRules.ruleIds, ruleId], ANALYTICS_EVENTS.rule_assigned, { source: "pair" })}
            onCreate={() => setCreateOpen(true)}
          />
        </NavigationMenu>
        <CreateRuleModal
          open={createOpen}
          onOpenChange={setCreateOpen}
          onError={setMutationError}
          onCreated={async (created) => {
            write([...pairRules.ruleIds, created.id], ANALYTICS_EVENTS.rule_assigned, { source: "pair" });
            await navigate({ to: "/dashboard/rules/$ruleId", params: { ruleId: created.id } });
          }}
        />
        <DashboardSection title="Other Pairs" description="Every other calendar pair you sync." />
        <NavigationMenu>
          {otherPairs.length === 0 && <NavigationMenuEmptyItem>No other pairs</NavigationMenuEmptyItem>}
          {otherPairs.map((other) => (
            <PairRow key={`${other.source.id}-${other.destination.id}`} pair={other} />
          ))}
        </NavigationMenu>
        <DashboardSection title="Calendars" description="Open either calendar to change what it sends or receives." />
        <NavigationMenu>
          <MetadataRow label="From" value={pair.source.name} truncate to={calendarPagePath(pair.source)} />
          <MetadataRow label="To" value={pair.destination.name} truncate to={calendarPagePath(pair.destination)} />
        </NavigationMenu>
      </PageBody>
    </div>
  );
}

function PairHeader({ pair }: { pair: CalendarPair }) {
  return (
    <div className="flex flex-col px-0.5 pt-4">
      <div className="flex min-w-0 items-center gap-2">
        <ProviderIcon provider={pair.source.provider} calendarType={pair.source.calendarType} size={18} />
        <DashboardHeading1 className="min-w-0 select-none">{pair.source.name}</DashboardHeading1>
        <ArrowRight size={18} className="shrink-0 text-emerald-500" />
        <ProviderIcon provider={pair.destination.provider} calendarType={pair.destination.calendarType} size={18} />
        <DashboardHeading1 className="min-w-0 select-none">{pair.destination.name}</DashboardHeading1>
      </div>
      <Text size="sm" tone="muted" className="truncate pt-0.5">
        {pair.source.accountLabel} → {pair.destination.accountLabel}
      </Text>
    </div>
  );
}
