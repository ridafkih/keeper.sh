import { createFileRoute } from "@tanstack/react-router";
import useSWR, { useSWRConfig } from "swr";
import { BackButton } from "@/components/ui/primitives/back-button";
import { DashboardHeading1, DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { PremiumGate } from "@/components/ui/primitives/menu-hint";
import { PageBody } from "@/components/ui/primitives/page-body";
import { ProviderIcon } from "@/components/ui/primitives/provider-icon";
import { StickyPageHeader } from "@/components/ui/primitives/sticky-page-header";
import { Text } from "@/components/ui/primitives/text";
import { NavigationMenu } from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { RouteShell } from "@/components/ui/shells/route-shell";
import { AvailabilityOverrideItem } from "@/features/dashboard/components/mapping-sync-rules/availability-override-item";
import { EventNameOverrideItems } from "@/features/dashboard/components/mapping-sync-rules/event-name-override-items";
import { ResetOverridesMenu } from "@/features/dashboard/components/mapping-sync-rules/reset-overrides-item";
import { SwitchRuleOverrideItem } from "@/features/dashboard/components/mapping-sync-rules/switch-rule-override-item";
import { UpstreamSourcesSection } from "@/features/dashboard/components/mapping-sync-rules/upstream-sources-section";
import { TitleKeywordsOverrideItems } from "@/features/dashboard/components/mapping-sync-rules/title-keywords-override-items";
import { useEntitlements } from "@/hooks/use-entitlements";
import { useMappingSyncRules } from "@/hooks/use-mapping-sync-rules";
import type { PatchRuleOverrides } from "@/hooks/use-mapping-sync-rules";
import { HttpError } from "@/lib/fetcher";
import type { CalendarDetail, CalendarSource, MappingSyncRules } from "@/types/api";
import { getDetailSwitchRules, getExclusionSwitchRules } from "@/utils/mapping-sync-rules";
import type { SwitchRule } from "@/utils/mapping-sync-rules";

export const Route = createFileRoute(
  "/(dashboard)/dashboard/accounts/$accountId/$calendarId_/destinations/$destinationId",
)({
  component: MappingSyncRulesPage,
});

const HTTP_NOT_FOUND = 404;

const isNotFound = (error: unknown): boolean =>
  error instanceof HttpError && error.status === HTTP_NOT_FOUND;

function MappingSyncRulesPage() {
  const { accountId, calendarId, destinationId } = Route.useParams();
  const backTo = `/dashboard/accounts/${accountId}/${calendarId}`;
  const sourceKey = `/api/sources/${calendarId}`;
  const { data: source, error: sourceError } = useSWR<CalendarDetail>(sourceKey);
  const { data: calendars, error: calendarsError } = useSWR<CalendarSource[]>("/api/sources");
  const {
    mapping,
    error: mappingError,
    patchOverrides,
    retry,
    saveError,
    setIncludeUpstreamSources,
  } = useMappingSyncRules(calendarId, destinationId);
  const { mutate } = useSWRConfig();
  const { data: entitlements } = useEntitlements();

  if (isNotFound(mappingError)) {
    return <MappingNotFound backTo={backTo} />;
  }

  if (sourceError || calendarsError || mappingError) {
    const retryAll = async () => {
      await Promise.all([mutate(sourceKey), mutate("/api/sources"), retry()]);
    };
    return <RouteShell backFallback={backTo} status="error" onRetry={retryAll} />;
  }

  const destination = calendars?.find((calendar) => calendar.id === destinationId);
  if (!source || !calendars || !mapping) {
    return <RouteShell backFallback={backTo} status="loading" />;
  }
  if (!destination) {
    return <MappingNotFound backTo={backTo} />;
  }

  const locked = Boolean(entitlements && !entitlements.canUseEventFilters);
  const disabled = !entitlements || locked;

  return (
    <div className="flex flex-col gap-1.5 lg:h-full">
      <StickyPageHeader className="gap-1.5">
        <BackButton fallback={backTo} />
        <MappingHeader source={source} destination={destination} />
      </StickyPageHeader>
      <PageBody className="gap-1.5">
        <DashboardSection
          title="Sync Settings"
          description={`Choose how events from ${source.name} appear in ${destination.name}. Anything left on Default follows ${source.name}'s own settings.`}
        />
        <PremiumGate limit="advanced_sync" locked={locked} hint="Per-calendar sync settings are a Pro feature.">
          <NavigationMenu>
            <EventNameOverrideItems mapping={mapping} locked={disabled} onPatch={patchOverrides} />
            <SwitchRuleItems
              rules={getDetailSwitchRules(source.provider)}
              mapping={mapping}
              locked={disabled}
              onPatch={patchOverrides}
            />
          </NavigationMenu>
        </PremiumGate>
        <DashboardSection
          title="Exclusions"
          description={`Choose which events from ${source.name} are left out of ${destination.name}.`}
        />
        <PremiumGate limit="event_exclusions" locked={locked} hint="Per-calendar exclusions are a Pro feature.">
          <NavigationMenu>
            <SwitchRuleItems
              rules={getExclusionSwitchRules(source.provider)}
              mapping={mapping}
              locked={disabled}
              onPatch={patchOverrides}
            />
            <AvailabilityOverrideItem
              mapping={mapping}
              provider={source.provider}
              locked={disabled}
              onPatch={patchOverrides}
            />
            <TitleKeywordsOverrideItems mapping={mapping} locked={disabled} onPatch={patchOverrides} />
          </NavigationMenu>
        </PremiumGate>
        <UpstreamSourcesSection
          mapping={mapping}
          sourceName={source.name}
          destinationName={destination.name}
          calendars={calendars}
          onChange={setIncludeUpstreamSources}
        />
        {saveError && <Text size="sm" tone="danger" className="px-0.5">{saveError}</Text>}
        <DashboardSection
          title="Reset"
          description={`Remove every customization so ${destination.name} follows ${source.name}'s own settings again.`}
        />
        <ResetOverridesMenu mapping={mapping} onPatch={patchOverrides} />
      </PageBody>
    </div>
  );
}

function MappingHeader({ source, destination }: { source: CalendarDetail; destination: CalendarSource }) {
  return (
    <div className="flex flex-col px-0.5 pt-4">
      <DashboardHeading1 className="select-none">{destination.name}</DashboardHeading1>
      <div className="flex items-center gap-1.5 pt-0.5">
        <ProviderIcon provider={source.provider} calendarType={source.calendarType} size={14} />
        <Text className="truncate overflow-hidden" size="sm" tone="muted">
          Receiving events from {source.name}
        </Text>
      </div>
    </div>
  );
}

function SwitchRuleItems({
  rules,
  mapping,
  locked,
  onPatch,
}: {
  rules: SwitchRule[];
  mapping: MappingSyncRules;
  locked: boolean;
  onPatch: PatchRuleOverrides;
}) {
  return (
    <>
      {rules.map((rule) => (
        <SwitchRuleOverrideItem
          key={rule.field}
          rule={rule}
          mapping={mapping}
          locked={locked}
          onPatch={onPatch}
        />
      ))}
    </>
  );
}

function MappingNotFound({ backTo }: { backTo: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <BackButton fallback={backTo} />
      <Text size="sm" tone="muted" className="px-0.5 pt-4">
        These calendars are not syncing with each other. Choose this calendar as a destination
        first, then customize how its events appear.
      </Text>
    </div>
  );
}
