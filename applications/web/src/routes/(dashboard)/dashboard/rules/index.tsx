import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import Plus from "lucide-react/dist/esm/icons/plus";
import { BackButton } from "@/components/ui/primitives/back-button";
import { DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { PremiumHint } from "@/components/ui/primitives/menu-hint";
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
  NavigationMenuItemTrailing,
  NavigationMenuLinkItem,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { canAddMore, useEntitlements } from "@/hooks/use-entitlements";
import type { AppJsonFetcher } from "@/lib/router-context";
import { pluralize } from "@/lib/pluralize";
import { countPairs, type SyncRuleListItem } from "@/features/rules/rules";
import { RULES_KEY, useRules } from "@/features/rules/use-rules";
import { usePairs } from "@/features/rules/use-pairs";
import { CreateRuleModal } from "@/features/rules/components/create-rule-modal";
import { PairRow } from "@/features/rules/components/pair-row";
import { RuleCard } from "@/features/rules/components/rule-card";

async function loadRules(fetchApi: AppJsonFetcher): Promise<SyncRuleListItem[] | null> {
  try {
    return await fetchApi<SyncRuleListItem[]>(RULES_KEY);
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/(dashboard)/dashboard/rules/")({
  loader: async ({ context }) => ({ rules: await loadRules(context.fetchApi) }),
  component: RulesPage,
});

function RulesPage() {
  const { rules: preloaded } = Route.useLoaderData();
  const navigate = useNavigate();
  const { data: entitlements } = useEntitlements();
  const { data: rules, error: rulesError, mutate: mutateRules } = useRules(preloaded ?? undefined);
  const { groups, error: pairsError, mutate: mutatePairs } = usePairs();
  const [createOpen, setCreateOpen] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  if (rulesError || pairsError) {
    return <RouteShell backFallback="/dashboard" status="error" onRetry={() => { void mutateRules(); void mutatePairs(); }} />;
  }
  if (!rules || !groups) return <RouteShell backFallback="/dashboard" status="loading" />;

  const canCreate = canAddMore(entitlements?.rules);
  const pairCount = countPairs(groups);

  return (
    <div className="flex flex-col gap-1.5 lg:h-full">
      <StickyPageHeader className="gap-1.5">
        <BackButton fallback="/dashboard" />
        <DashboardSection
          title="Rules"
          description="A rule decides which events are copied and how their copies look. Apply rules to calendar pairs below."
        />
      </StickyPageHeader>
      <PageBody className="gap-1.5">
        {mutationError && <Text size="sm" tone="danger">{mutationError}</Text>}
        <NavigationMenu>
          {rules.map((rule) => <RuleCard key={rule.id} rule={rule} />)}
          <NavigationMenuButtonItem disabled={!canCreate} onClick={() => setCreateOpen(true)}>
            <NavigationMenuItemIcon>
              <Plus size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>New Rule</NavigationMenuItemLabel>
          </NavigationMenuButtonItem>
        </NavigationMenu>
        {!canCreate && <PremiumHint>Free plans include one rule.</PremiumHint>}
        <CreateRuleModal
          open={createOpen}
          onOpenChange={setCreateOpen}
          onError={setMutationError}
          onCreated={(created) => navigate({ to: "/dashboard/rules/$ruleId", params: { ruleId: created.id } })}
        />
        <DashboardSection
          title="Calendar Pairs"
          description={pairCount > 0 ? `${pluralize(pairCount, "pair")}. Tap one to choose which rules it applies.` : "Every calendar that copies events into another."}
        />
        {groups.length === 0 && (
          <NavigationMenu>
            <NavigationMenuEmptyItem>No pairs yet</NavigationMenuEmptyItem>
          </NavigationMenu>
        )}
        {groups.map((group) => (
          <div key={group.source.id} className="flex flex-col gap-1.5">
            <Text size="xs" tone="muted" className="px-0.5 pt-2 truncate">
              {group.source.name} · {group.source.accountLabel}
            </Text>
            <NavigationMenu>
              {group.destinations.map((destination) => (
                <PairRow key={destination.id} pair={{ destination, source: group.source }} />
              ))}
            </NavigationMenu>
          </div>
        ))}
        <NavigationMenu>
          <NavigationMenuLinkItem to="/dashboard/setup">
            <NavigationMenuItemIcon>
              <Plus size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>Set Up a New Pair</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing />
          </NavigationMenuLinkItem>
        </NavigationMenu>
      </PageBody>
    </div>
  );
}
