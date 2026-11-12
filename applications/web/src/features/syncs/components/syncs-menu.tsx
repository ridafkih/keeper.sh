import List from "lucide-react/dist/esm/icons/list";
import Plus from "lucide-react/dist/esm/icons/plus";
import Waypoints from "lucide-react/dist/esm/icons/waypoints";
import type { SyncSummary } from "@keeper.sh/data-schemas";
import { Text } from "@/components/ui/primitives/text";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
  NavigationMenuLinkItem,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { canAddMore, useEntitlements } from "@/hooks/use-entitlements";
import { formatSyncedAgo } from "../relative-time";
import { SIDEBAR_SYNC_LIMIT, summarizeSync, syncPagePath, type CalendarsById } from "../syncs";
import { useSyncRows } from "../use-syncs";
import { SyncStatusDot } from "./sync-status-dot";

export function SyncsMenu() {
  const { calendarsById, syncs } = useSyncRows();
  const { data: entitlements } = useEntitlements();
  const shown = (syncs ?? []).slice(0, SIDEBAR_SYNC_LIMIT);
  const hidden = (syncs ?? []).slice(SIDEBAR_SYNC_LIMIT);
  const hiddenProblems = hidden.filter((sync) => sync.state === "problem").length;

  return (
    <NavigationMenu>
      <NavigationMenuItem>
        <NavigationMenuItemIcon>
          <Waypoints size={15} />
        </NavigationMenuItemIcon>
        <NavigationMenuItemLabel>Syncs</NavigationMenuItemLabel>
        <NavigationMenuItemTrailing>
          {syncs && <Text size="sm" tone="muted">{syncs.length}</Text>}
        </NavigationMenuItemTrailing>
      </NavigationMenuItem>
      {shown.map((sync) => (
        <SyncRow key={sync.id} sync={sync} calendarsById={calendarsById} />
      ))}
      {hidden.length > 0 && (
        <NavigationMenuLinkItem to="/dashboard/syncs">
          <NavigationMenuItemIcon>
            <List size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>View All Syncs</NavigationMenuItemLabel>
          <NavigationMenuItemTrailing>
            {hiddenProblems > 0 && (
              <Text size="sm" tone="attention" className="shrink-0">
                {hiddenProblems} {hiddenProblems === 1 ? "needs" : "need"} attention ·
              </Text>
            )}
            <Text size="sm" tone="muted" className="shrink-0">{hidden.length} more</Text>
          </NavigationMenuItemTrailing>
        </NavigationMenuLinkItem>
      )}
      <NewSyncRow atLimit={!canAddMore(entitlements?.syncs)} />
    </NavigationMenu>
  );
}

export function NewSyncRow({ atLimit, active }: { atLimit: boolean; active?: boolean }) {
  return (
    <NavigationMenuLinkItem to="/dashboard/syncs/new" className={active ? "bg-background-hover" : undefined}>
      <NavigationMenuItemIcon>
        <Plus size={15} />
      </NavigationMenuItemIcon>
      <NavigationMenuItemLabel>New Sync</NavigationMenuItemLabel>
      <NavigationMenuItemTrailing>
        {atLimit && <Text size="sm" tone="muted">Pro</Text>}
      </NavigationMenuItemTrailing>
    </NavigationMenuLinkItem>
  );
}

export function SyncRow({ sync, calendarsById, active }: { sync: SyncSummary; calendarsById: CalendarsById; active?: boolean }) {
  const trailing = sync.state === "problem"
    ? <Text size="sm" tone="attention">Needs attention</Text>
    : <Text size="sm" tone="muted">{sync.state === "paused" ? "Paused" : formatSyncedAgo(sync.lastSyncedAt)}</Text>;

  return (
    <NavigationMenuLinkItem to={syncPagePath(sync.id)} className={active ? "bg-background-hover" : undefined}>
      <SyncStatusDot state={sync.state} className="ml-1" />
      <div className="flex min-w-0 flex-col">
        <NavigationMenuItemLabel tone="default">{sync.name}</NavigationMenuItemLabel>
        <Text size="xs" tone="muted" className="truncate">{summarizeSync(sync, calendarsById)}</Text>
      </div>
      <NavigationMenuItemTrailing className="ml-auto shrink-0 grow-0" indicator={trailing} />
    </NavigationMenuLinkItem>
  );
}
