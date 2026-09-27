import Plus from "lucide-react/dist/esm/icons/plus";
import useSWR from "swr";
import { DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { Text } from "@/components/ui/primitives/text";
import {
  NavigationMenu,
  NavigationMenuEmptyItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
  NavigationMenuLinkItem,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import type { CalendarSource } from "@/types/api";
import { roleIn, summarizeSync, syncPagePath } from "../syncs";
import { useSyncs } from "../use-syncs";
import { SyncStatusDot } from "./sync-status-dot";

export function InSyncsSection({ calendarId, calendarName }: { calendarId: string; calendarName: string }) {
  const { data: syncs } = useSyncs();
  const { data: calendars } = useSWR<CalendarSource[]>("/api/sources");
  const calendarsById = new Map((calendars ?? []).map((calendar) => [calendar.id, calendar] as const));
  const memberships = (syncs ?? []).flatMap((sync) => {
    const role = roleIn(sync, calendarId);
    return role ? [{ role, sync }] : [];
  });

  return (
    <>
      <DashboardSection
        title="Syncs"
        description={`Where ${calendarName}'s events go and what comes into it. Change these on each sync.`}
      />
      <NavigationMenu>
        {syncs && memberships.length === 0 && <NavigationMenuEmptyItem>Not in any sync yet</NavigationMenuEmptyItem>}
        {memberships.map(({ role, sync }) => (
          <NavigationMenuLinkItem key={sync.id} to={syncPagePath(sync.id)}>
            <SyncStatusDot state={sync.state} className="ml-1" />
            <div className="flex min-w-0 flex-col">
              <NavigationMenuItemLabel tone="default">{sync.name}</NavigationMenuItemLabel>
              <Text size="xs" tone="muted" className="truncate">{summarizeSync(sync, calendarsById)}</Text>
            </div>
            <NavigationMenuItemTrailing className="ml-auto shrink-0 grow-0">
              <Text size="sm" tone="muted">{role}</Text>
            </NavigationMenuItemTrailing>
          </NavigationMenuLinkItem>
        ))}
        <NavigationMenuLinkItem to={`/dashboard/syncs/new?from=${calendarId}`}>
          <NavigationMenuItemIcon>
            <Plus size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>New Sync From This Calendar</NavigationMenuItemLabel>
          <NavigationMenuItemTrailing />
        </NavigationMenuLinkItem>
      </NavigationMenu>
    </>
  );
}
