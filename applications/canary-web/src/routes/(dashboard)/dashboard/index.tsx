import { createFileRoute, useNavigate } from "@tanstack/react-router";
import useSWR, { preload } from "swr";
import { CalendarPlus, CalendarSync, CalendarDays, Settings, Sparkles, LogOut, LoaderCircle } from "lucide-react";
import { ErrorState } from "../../../components/ui/error-state";
import { signOut } from "../../../lib/auth";
import { fetcher } from "../../../lib/fetcher";
import KeeperLogo from "../../../assets/keeper.svg?react";
import { EventGraph } from "../../../components/dashboard/event-graph";
import { ProviderIcon } from "../../../components/ui/provider-icon";
import type { CalendarSource } from "../../../types/api";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "../../../components/ui/navigation-menu";
import { Text } from "../../../components/ui/text";
import { getAccountLabel } from "../../../utils/accounts";

export const Route = createFileRoute("/(dashboard)/dashboard/")({
  component: DashboardPage,
});

function DashboardPage() {
  const navigate = useNavigate();
  const handleLogout = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  const { data: calendarsData, isLoading: calendarsLoading, error, mutate: mutateCalendars } = useSWR<CalendarSource[]>("/api/sources");
  const calendars = calendarsData ?? [];

  return (
    <div className="flex flex-col gap-4">
      <EventGraph />
      <div className="flex flex-col gap-1.5">
        <NavigationMenu>
          <NavigationMenuItem to="/dashboard/connect">
            <NavigationMenuItemIcon>
              <CalendarPlus size={15} />
              <NavigationMenuItemLabel>Link Calendar Account</NavigationMenuItemLabel>
            </NavigationMenuItemIcon>
            <NavigationMenuItemTrailing />
          </NavigationMenuItem>
        </NavigationMenu>
        <NavigationMenu>
          {error && <ErrorState message="Failed to load calendars." onRetry={() => mutateCalendars()} />}
          {calendarsLoading && (
            <div className="flex justify-center py-4">
              <LoaderCircle size={16} className="animate-spin text-foreground-muted" />
            </div>
          )}
          {calendars.map((calendar) => (
            <NavigationMenuItem
              key={calendar.id}
              to={`/dashboard/accounts/${calendar.accountId}/${calendar.id}`}
              onMouseEnter={() => {
                preload(`/api/accounts/${calendar.accountId}`, fetcher);
                preload(`/api/sources/${calendar.id}`, fetcher);
              }}
            >
              <div className="flex items-center gap-2 shrink-0">
                <ProviderIcon provider={calendar.provider} calendarType={calendar.calendarType} />
                <Text size="sm" tone="muted">{calendar.name}</Text>
              </div>
              <div className="min-w-0">
                <Text size="sm" tone="muted" className="truncate">
                  {getAccountLabel(calendar)}
                </Text>
              </div>
            </NavigationMenuItem>
          ))}
        </NavigationMenu>
        {calendars.length > 0 && (
          <NavigationMenu>
            <NavigationMenuItem to="/dashboard/calendars">
              <NavigationMenuItemIcon>
                <CalendarSync size={15} />
                <NavigationMenuItemLabel>Sync Settings</NavigationMenuItemLabel>
              </NavigationMenuItemIcon>
              <NavigationMenuItemTrailing />
            </NavigationMenuItem>
          </NavigationMenu>
        )}
        <NavigationMenu>
          <NavigationMenuItem to="/dashboard/events">
            <NavigationMenuItemIcon>
              <CalendarDays size={15} />
              <NavigationMenuItemLabel>View Events</NavigationMenuItemLabel>
            </NavigationMenuItemIcon>
            <NavigationMenuItemTrailing />
          </NavigationMenuItem>
        </NavigationMenu>
        <NavigationMenu variant="highlight">
          <NavigationMenuItem to="/dashboard/upgrade">
            <NavigationMenuItemIcon>
              <Sparkles size={15} />
              <NavigationMenuItemLabel>Upgrade Account</NavigationMenuItemLabel>
            </NavigationMenuItemIcon>
            <NavigationMenuItemTrailing />
          </NavigationMenuItem>
        </NavigationMenu>
        <NavigationMenu>
          <NavigationMenuItem to="/dashboard/settings">
            <NavigationMenuItemIcon>
              <Settings size={15} />
              <NavigationMenuItemLabel>Settings</NavigationMenuItemLabel>
            </NavigationMenuItemIcon>
            <NavigationMenuItemTrailing />
          </NavigationMenuItem>
          <NavigationMenuItem onClick={handleLogout}>
            <NavigationMenuItemIcon>
              <LogOut size={15} />
              <NavigationMenuItemLabel>Logout</NavigationMenuItemLabel>
            </NavigationMenuItemIcon>
          </NavigationMenuItem>
        </NavigationMenu>
      </div>
      <KeeperLogo className="size-8 text-border-elevated self-center" />
    </div>
  );
}
