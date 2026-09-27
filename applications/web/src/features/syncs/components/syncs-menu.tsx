import Plus from "lucide-react/dist/esm/icons/plus";
import Waypoints from "lucide-react/dist/esm/icons/waypoints";
import useSWR from "swr";
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
import type { CalendarSource } from "@/types/api";
import { formatSyncedAgo } from "../relative-time";
import { summarizeSync, syncPagePath } from "../syncs";
import { useSyncs } from "../use-syncs";
import { SyncStatusDot } from "./sync-status-dot";

export function SyncsMenu() {
  const { data: syncs } = useSyncs();
  const { data: calendars } = useSWR<CalendarSource[]>("/api/sources");
  const { data: entitlements } = useEntitlements();
  const calendarsById = new Map((calendars ?? []).map((calendar) => [calendar.id, calendar] as const));
  const atLimit = !canAddMore(entitlements?.syncs);

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
      {(syncs ?? []).map((sync) => (
        <SyncRow key={sync.id} sync={sync} summary={summarizeSync(sync, calendarsById)} />
      ))}
      <NavigationMenuLinkItem to="/dashboard/syncs/new">
        <NavigationMenuItemIcon>
          <Plus size={15} />
        </NavigationMenuItemIcon>
        <NavigationMenuItemLabel>New Sync</NavigationMenuItemLabel>
        <NavigationMenuItemTrailing>
          {atLimit && <Text size="sm" tone="muted">Pro</Text>}
        </NavigationMenuItemTrailing>
      </NavigationMenuLinkItem>
    </NavigationMenu>
  );
}

function SyncRow({ sync, summary }: { sync: SyncSummary; summary: string }) {
  const trailing = sync.state === "problem"
    ? <Text size="sm" tone="attention">Needs attention</Text>
    : <Text size="sm" tone="muted">{sync.state === "paused" ? "Paused" : formatSyncedAgo(sync.lastSyncedAt)}</Text>;

  return (
    <NavigationMenuLinkItem to={syncPagePath(sync.id)}>
      <SyncStatusDot state={sync.state} className="ml-1" />
      <div className="flex min-w-0 flex-col">
        <NavigationMenuItemLabel tone="default">{sync.name}</NavigationMenuItemLabel>
        <Text size="xs" tone="muted" className="truncate">{summary}</Text>
      </div>
      <NavigationMenuItemTrailing className="ml-auto shrink-0 grow-0" indicator={trailing} />
    </NavigationMenuLinkItem>
  );
}
