import { createFileRoute, useNavigate } from "@tanstack/react-router";
import useSWR, { preload } from "swr";
import { AnimatePresence, motion } from "motion/react";
import { Calendar, CalendarPlus, CalendarSync, CalendarDays, Settings, Sparkles, LogOut, LoaderCircle } from "lucide-react";
import { ErrorState } from "../../../components/ui/error-state";
import { signOut } from "../../../lib/auth";
import { fetcher } from "../../../lib/fetcher";
import KeeperLogo from "../../../assets/keeper.svg?react";
import { EventGraph } from "../../../components/dashboard/event-graph";
import { ProviderIcon } from "../../../components/ui/provider-icon";
import type { CalendarAccount, CalendarSource } from "../../../types/api";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
  NavigationMenuPopover,
} from "../../../components/ui/navigation-menu";
import { Text } from "../../../components/ui/text";
import { ProviderIconStack } from "../../../components/ui/provider-icon-stack";
import { getAccountLabel } from "../../../utils/accounts";
import { pluralize } from "../../../lib/pluralize";
import { useAnimatedSWR } from "../../../hooks/use-animated-swr";
import { User } from "lucide-react";

const SECTION_HIDDEN = { height: 0, opacity: 0, filter: "blur(4px)" };
const SECTION_VISIBLE = { height: "fit-content", opacity: 1, filter: "blur(0)" };

function resolveAnimateInitial(shouldAnimate: boolean) {
  if (shouldAnimate) return SECTION_HIDDEN;
  return false as const;
}

export const Route = createFileRoute("/(dashboard)/dashboard/")({
  component: DashboardPage,
});

function DashboardPage() {
  const navigate = useNavigate();
  const handleLogout = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  const { data: accountsData, shouldAnimate: animateAccounts } = useAnimatedSWR<CalendarAccount[]>("/api/accounts");
  const accounts = accountsData ?? [];

  const { data: calendarsData, shouldAnimate: animateCalendars, isLoading: calendarsLoading, error, mutate: mutateCalendars } = useAnimatedSWR<CalendarSource[]>("/api/sources");
  const calendars = calendarsData ?? [];

  const { data: eventCountData } = useSWR<{ count: number }>("/api/events/count");
  const eventCount = eventCountData?.count;

  return (
    <div className="flex flex-col">
      <EventGraph />
      <div className="flex flex-col gap-1.5">
        <NavigationMenu>
          <NavigationMenuPopover
            trigger={
              <>
                <NavigationMenuItemIcon>
                  <User size={15} />
                </NavigationMenuItemIcon>
                <NavigationMenuItemLabel>Calendar Sources</NavigationMenuItemLabel>
                <NavigationMenuItemTrailing>
                  <ProviderIconStack providers={accounts} />
                </NavigationMenuItemTrailing>
              </>
            }
          >
            {accounts.map((account) => (
              <NavigationMenuItem
                key={account.id}
                to={`/dashboard/accounts/${account.id}`}
              >
                <NavigationMenuItemIcon>
                  <ProviderIcon provider={account.provider} />
                </NavigationMenuItemIcon>
                <NavigationMenuItemLabel>{getAccountLabel(account)}</NavigationMenuItemLabel>
                <NavigationMenuItemTrailing />
              </NavigationMenuItem>
            ))}
          </NavigationMenuPopover>
          <NavigationMenuItem to="/dashboard/connect">
            <NavigationMenuItemIcon>
              <CalendarPlus size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>Add Calendar Source</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing />
          </NavigationMenuItem>
        </NavigationMenu>
        <NavigationMenu>
          <NavigationMenuPopover
            trigger={
              <>
                <NavigationMenuItemIcon>
                  <Calendar size={15} />
                </NavigationMenuItemIcon>
                <NavigationMenuItemLabel>Calendars</NavigationMenuItemLabel>
                <NavigationMenuItemTrailing>
                  <ProviderIconStack providers={calendars} />
                </NavigationMenuItemTrailing>
              </>
            }
          >
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
                <NavigationMenuItemIcon>
                  <ProviderIcon provider={calendar.provider} calendarType={calendar.calendarType} />
                </NavigationMenuItemIcon>
                <NavigationMenuItemLabel className="shrink-0">{calendar.name}</NavigationMenuItemLabel>
                <NavigationMenuItemTrailing className="overflow-hidden">
                  <Text size="sm" tone="muted" className="flex-1 min-w-0 truncate text-right">
                    {getAccountLabel(calendar)}
                  </Text>
                </NavigationMenuItemTrailing>
              </NavigationMenuItem>
            ))}
          </NavigationMenuPopover>
          <AnimatePresence>
            {calendars.length > 0 && (
              <motion.div
                className="overflow-hidden"
                initial={resolveAnimateInitial(animateCalendars)}
                animate={SECTION_VISIBLE}
                exit={SECTION_HIDDEN}
              >
                <NavigationMenuItem to="/dashboard/events">
                  <NavigationMenuItemIcon>
                    <CalendarDays size={15} />
                  </NavigationMenuItemIcon>
                  <NavigationMenuItemLabel>View Events</NavigationMenuItemLabel>
                  <NavigationMenuItemTrailing>
                    {eventCount != null && <Text size="sm" tone="muted">{pluralize(eventCount, "event")}</Text>}
                  </NavigationMenuItemTrailing>
                </NavigationMenuItem>
                <NavigationMenuItem to="/dashboard/calendars">
                  <NavigationMenuItemIcon>
                    <CalendarSync size={15} />
                  </NavigationMenuItemIcon>
                  <NavigationMenuItemLabel>Sync Settings</NavigationMenuItemLabel>
                  <NavigationMenuItemTrailing />
                </NavigationMenuItem>
              </motion.div>
            )}
          </AnimatePresence>
        </NavigationMenu>
        <NavigationMenu variant="highlight">
          <NavigationMenuItem to="/dashboard/upgrade">
            <NavigationMenuItemIcon>
              <Sparkles size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>Upgrade Account</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing />
          </NavigationMenuItem>
        </NavigationMenu>
        <NavigationMenu>
          <NavigationMenuItem to="/dashboard/settings">
            <NavigationMenuItemIcon>
              <Settings size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>Settings</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing />
          </NavigationMenuItem>
          <NavigationMenuItem onClick={handleLogout}>
            <NavigationMenuItemIcon>
              <LogOut size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>Logout</NavigationMenuItemLabel>
          </NavigationMenuItem>
        </NavigationMenu>
      </div>
      <div className="pt-8 flex justify-center">
        <KeeperLogo className="size-8 text-border-elevated self-center" />
      </div>
    </div>
  );
}
