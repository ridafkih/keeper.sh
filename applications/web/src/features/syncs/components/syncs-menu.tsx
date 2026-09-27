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
  const hidden = (syncs?.length ?? 0) - shown.length;

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
      {hidden > 0 && (
        <NavigationMenuLinkItem to="/dashboard/syncs">
          <NavigationMenuItemIcon>
            <List size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>View All Syncs</NavigationMenuItemLabel>
          <NavigationMenuItemTrailing>
            <Text size="sm" tone="muted">{hidden} more</Text>
          </NavigationMenuItemTrailing>
        </NavigationMenuLinkItem>
      )}
      <NewSyncRow atLimit={!canAddMore(entitlements?.syncs)} />
    </NavigationMenu>
  );
}

export function NewSyncRow({ atLimit }: { atLimit: boolean }) {
  return (
    <NavigationMenuLinkItem to="/dashboard/syncs/new">
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

export function SyncRow({ sync, calendarsById }: { sync: SyncSummary; calendarsById: CalendarsById }) {
  const trailing = sync.state === "problem"
    ? <Text size="sm" tone="attention">Needs attention</Text>
    : <Text size="sm" tone="muted">{sync.state === "paused" ? "Paused" : formatSyncedAgo(sync.lastSyncedAt)}</Text>;

  return (
    <NavigationMenuLinkItem to={syncPagePath(sync.id)}>
      <SyncStatusDot state={sync.state} className="ml-1" />
      <div className="flex min-w-0 flex-col">
        <NavigationMenuItemLabel tone="default">{sync.name}</NavigationMenuItemLabel>
        <Text size="xs" tone="muted" className="truncate">{summarizeSync(sync, calendarsById)}</Text>
      </div>
      <NavigationMenuItemTrailing className="ml-auto shrink-0 grow-0" indicator={trailing} />
    </NavigationMenuLinkItem>
  );
}
