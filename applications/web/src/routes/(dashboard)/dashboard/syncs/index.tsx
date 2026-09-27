import { createFileRoute } from "@tanstack/react-router";
import { BackButton } from "@/components/ui/primitives/back-button";
import { DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { PageBody } from "@/components/ui/primitives/page-body";
import { PremiumHint } from "@/components/ui/primitives/menu-hint";
import { StickyPageHeader } from "@/components/ui/primitives/sticky-page-header";
import { RouteShell } from "@/components/ui/shells/route-shell";
import { NavigationMenu, NavigationMenuEmptyItem } from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { canAddMore, useEntitlements } from "@/hooks/use-entitlements";
import { NewSyncRow, SyncRow } from "@/features/syncs/components/syncs-menu";
import { useSyncRows } from "@/features/syncs/use-syncs";

export const Route = createFileRoute("/(dashboard)/dashboard/syncs/")({
  component: SyncsPage,
});

function SyncsPage() {
  const { calendarsById, error, mutate, syncs } = useSyncRows();
  const { data: entitlements } = useEntitlements();

  if (error) return <RouteShell backFallback="/dashboard" status="error" onRetry={() => { void mutate(); }} />;
  if (!syncs) return <RouteShell backFallback="/dashboard" status="loading" />;

  const atLimit = !canAddMore(entitlements?.syncs);

  return (
    <div className="flex flex-col gap-1.5 lg:h-full">
      <StickyPageHeader className="gap-1.5">
        <BackButton fallback="/dashboard" />
        <DashboardSection
          title="Syncs"
          description={`${syncs.length === 1 ? "1 sync" : `${syncs.length} syncs`}, newest first. Each one decides which calendars copy into which, and how.`}
        />
      </StickyPageHeader>
      <PageBody className="gap-1.5">
        <NavigationMenu>
          {syncs.length === 0 && <NavigationMenuEmptyItem>No syncs yet</NavigationMenuEmptyItem>}
          {syncs.map((sync) => (
            <SyncRow key={sync.id} sync={sync} calendarsById={calendarsById} />
          ))}
          <NewSyncRow atLimit={atLimit} />
        </NavigationMenu>
        {atLimit && <PremiumHint>Free plans include one sync. Your existing syncs keep running.</PremiumHint>}
      </PageBody>
    </div>
  );
}
