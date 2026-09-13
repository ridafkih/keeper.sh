import { createFileRoute, useNavigate } from "@tanstack/react-router";
import useSWR from "swr";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import Plus from "lucide-react/dist/esm/icons/plus";
import { BackButton } from "@/components/ui/primitives/back-button";
import { DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { ProviderIcon } from "@/components/ui/primitives/provider-icon";
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
import { pluralize } from "@/lib/pluralize";
import type { CalendarSource } from "@/types/api";
import { createEditDraft } from "@/features/setup/setup-draft";
import { useSetupDraft } from "@/features/setup/use-setup-draft";
import { buildRuleGroups, countRules, titleModeLabel, toDetailChoice, type RuleGroup } from "@/features/rules/rules";
import { useSourceDetails } from "@/features/rules/use-source-details";

export const Route = createFileRoute("/(dashboard)/dashboard/rules")({
  component: RulesPage,
});

function RulesPage() {
  const navigate = useNavigate();
  const { replaceDraft } = useSetupDraft();
  const { data: sources, error: sourcesError, mutate: mutateSources } = useSWR<CalendarSource[]>("/api/sources");
  const { data: details, error: detailsError, mutate: mutateDetails } = useSourceDetails(sources);

  if (sourcesError || detailsError) {
    return <RouteShell backFallback="/dashboard" status="error" onRetry={() => { void mutateSources(); void mutateDetails(); }} />;
  }
  if (!sources || !details) return <RouteShell backFallback="/dashboard" status="loading" />;

  const groups = buildRuleGroups(sources, details);
  const total = countRules(groups);

  const edit = (group: RuleGroup) => {
    const mode = group.rows[0]?.mode ?? "calendar_name";
    replaceDraft(createEditDraft(group.source.id, group.detail.destinationIds, toDetailChoice(mode)));
    navigate({ to: "/dashboard/setup" });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <BackButton fallback="/dashboard" />
      <DashboardSection
        title="Rules"
        description={total > 0 ? `${pluralize(total, "rule")}. Tap one to change where that calendar sends events.` : "Every calendar that copies events into another."}
      />
      {groups.length === 0 && (
        <NavigationMenu>
          <NavigationMenuEmptyItem>No rules yet</NavigationMenuEmptyItem>
        </NavigationMenu>
      )}
      {groups.map((group) => (
        <div key={group.source.id} className="flex flex-col gap-1.5">
          <Text size="xs" tone="muted" className="px-0.5 pt-2 truncate">
            {group.source.name} · {group.source.accountLabel}
          </Text>
          <NavigationMenu>
            {group.rows.map((row) => (
              <NavigationMenuButtonItem key={row.destination.id} onClick={() => edit(group)}>
                <NavigationMenuItemIcon>
                  <ProviderIcon provider={group.source.provider} calendarType={group.source.calendarType} />
                </NavigationMenuItemIcon>
                <NavigationMenuItemLabel className="shrink-0 max-w-[30%]">{group.source.name}</NavigationMenuItemLabel>
                <ArrowRight size={14} className="shrink-0 text-emerald-500" />
                <NavigationMenuItemIcon>
                  <ProviderIcon provider={row.destination.provider} calendarType={row.destination.calendarType} />
                </NavigationMenuItemIcon>
                <NavigationMenuItemLabel>{row.destination.name}</NavigationMenuItemLabel>
                <NavigationMenuItemTrailing className="shrink-0 grow-0 max-w-[36%]">
                  <Text size="sm" tone="muted" className="min-w-0 truncate">{titleModeLabel(row.mode, row.customTitle)}</Text>
                  <ChevronRight size={14} className="shrink-0 text-foreground-muted" />
                </NavigationMenuItemTrailing>
              </NavigationMenuButtonItem>
            ))}
          </NavigationMenu>
        </div>
      ))}
      <NavigationMenu>
        <NavigationMenuLinkItem to="/dashboard/setup">
          <NavigationMenuItemIcon>
            <Plus size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>Add a Rule</NavigationMenuItemLabel>
          <NavigationMenuItemTrailing />
        </NavigationMenuLinkItem>
      </NavigationMenu>
    </div>
  );
}
