import { useState, useTransition } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import useSWR, { preload, useSWRConfig } from "swr";
import { AnimatedReveal } from "@/components/ui/primitives/animated-reveal";
import Calendar from "lucide-react/dist/esm/icons/calendar";
import CalendarPlus from "lucide-react/dist/esm/icons/calendar-plus";
import CalendarDays from "lucide-react/dist/esm/icons/calendar-days";
import Link2 from "lucide-react/dist/esm/icons/link-2";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import Settings from "lucide-react/dist/esm/icons/settings";
import LogOut from "lucide-react/dist/esm/icons/log-out";
import MessageSquare from "lucide-react/dist/esm/icons/message-square";
import Bug from "lucide-react/dist/esm/icons/bug";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import User from "lucide-react/dist/esm/icons/user";
import { ErrorState } from "@/components/ui/primitives/error-state";
import { signOut } from "@/lib/auth";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { apiFetch, fetcher } from "@/lib/fetcher";
import { invalidateAccountsAndSources } from "@/lib/swr";
import { resolveErrorMessage } from "@/utils/errors";
import { useCountdown } from "@/hooks/use-countdown";
import {
  formatRefreshFailures,
  formatRefreshSummary,
  refreshCalendarsResponseSchema,
} from "@/features/dashboard/components/refresh-summary";
import KeeperLogo from "@/assets/keeper.svg?react";
import { EventGraph } from "@/features/dashboard/components/event-graph";
import { ProviderIcon } from "@/components/ui/primitives/provider-icon";
import type { CalendarAccount, CalendarSource } from "@/types/api";
import {
  NavigationMenu,
  NavigationMenuButtonItem,
  NavigationMenuLinkItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { NavigationMenuPopover } from "@/components/ui/composites/navigation-menu/navigation-menu-popover";
import { Text } from "@/components/ui/primitives/text";
import { ProviderIconStack } from "@/components/ui/primitives/provider-icon-stack";
import { pluralize } from "@/lib/pluralize";
import { useAnimatedSWR } from "@/hooks/use-animated-swr";
import { SyncStatus } from "@/features/dashboard/components/sync-status";

export const Route = createFileRoute("/(dashboard)/dashboard/")({
  component: DashboardPage,
});

function DashboardPage() {
  const navigate = useNavigate();

  const handleLogout = async () => {
    track(ANALYTICS_EVENTS.logout);
    await signOut();
    navigate({ to: "/" });
  };

  return (
    <div className="flex flex-col">
      <SyncStatus />
      <EventGraph />
      <div className="flex flex-col gap-1.5">
        <CalendarSourcesMenu />
        <CalendarsMenu />
        <NavigationMenu>
          <NavigationMenuLinkItem to="/dashboard/feedback">
            <NavigationMenuItemIcon>
              <MessageSquare size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>Submit Feedback</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing />
          </NavigationMenuLinkItem>
          <NavigationMenuLinkItem to="/dashboard/report">
            <NavigationMenuItemIcon>
              <Bug size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>Report a Problem</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing />
          </NavigationMenuLinkItem>
        </NavigationMenu>
        <NavigationMenu>
          <AccountsPopover />
          <NavigationMenuLinkItem to="/dashboard/settings">
            <NavigationMenuItemIcon>
              <Settings size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>Settings</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing />
          </NavigationMenuLinkItem>
        </NavigationMenu>
        <NavigationMenu>
          <NavigationMenuButtonItem onClick={handleLogout}>
            <NavigationMenuItemIcon>
              <LogOut size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>Logout</NavigationMenuItemLabel>
          </NavigationMenuButtonItem>
        </NavigationMenu>
      </div>
      <div className="pt-8 flex justify-center">
        <KeeperLogo className="size-8 text-border-elevated self-center" />
      </div>
    </div>
  );
}

interface RefreshStatus {
  message: string;
  tone: "muted" | "danger";
}

function CalendarSourcesMenu() {
  const { mutate: globalMutate } = useSWRConfig();
  const [isRefreshing, startRefreshTransition] = useTransition();
  const [status, setStatus] = useState<RefreshStatus | null>(null);
  const { secondsRemaining, start: startCooldown } = useCountdown();

  const handleRefresh = () => {
    setStatus(null);

    startRefreshTransition(async () => {
      try {
        const response = await apiFetch("/api/accounts/refresh-calendars", { method: "POST" });
        const result = refreshCalendarsResponseSchema.assert(await response.json());
        track(ANALYTICS_EVENTS.calendars_refreshed, { accounts: result.accounts });
        await invalidateAccountsAndSources(globalMutate);
        startCooldown(result.cooldownSeconds);

        const failures = formatRefreshFailures(result.failed);
        setStatus({
          message: [formatRefreshSummary(result), failures].filter(Boolean).join(" "),
          tone: failures ? "danger" : "muted",
        });
      } catch (err) {
        setStatus({
          message: resolveErrorMessage(err, "Failed to refresh calendars."),
          tone: "danger",
        });
      }
    });
  };

  const isCoolingDown = secondsRemaining > 0;

  return (
    <>
      <NavigationMenu>
        <NavigationMenuLinkItem to="/dashboard/connect">
          <NavigationMenuItemIcon>
            <CalendarPlus size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>Import Calendars</NavigationMenuItemLabel>
          <NavigationMenuItemTrailing />
        </NavigationMenuLinkItem>
        <NavigationMenuButtonItem
          onClick={isRefreshing || isCoolingDown ? undefined : handleRefresh}
          disabled={isRefreshing || isCoolingDown}
        >
          <NavigationMenuItemIcon>
            <RefreshCw size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>
            {isRefreshing ? "Refreshing..." : "Refresh Calendars"}
          </NavigationMenuItemLabel>
          <NavigationMenuItemTrailing>
            {isCoolingDown && <Text size="sm" tone="muted">{secondsRemaining}s</Text>}
          </NavigationMenuItemTrailing>
        </NavigationMenuButtonItem>
      </NavigationMenu>
      {status && <Text size="sm" tone={status.tone}>{status.message}</Text>}
    </>
  );
}

function CalendarsMenu() {
  const { data: calendarsData, shouldAnimate: animateCalendars, isLoading: calendarsLoading, error, mutate: mutateCalendars } = useAnimatedSWR<CalendarSource[]>("/api/sources");
  const calendars = calendarsData ?? [];

  const { data: eventCountData, error: eventCountError } = useSWR<{ count: number }>("/api/events/count");
  const eventCount = eventCountError ? undefined : eventCountData?.count;

  return (
    <NavigationMenu>
      <NavigationMenuPopover
        disabled={calendars.length === 0 && !calendarsLoading}
        trigger={
          <>
            <NavigationMenuItemIcon>
              <Calendar size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>
              {calendars.length > 0 ? "Calendars" : "No Calendars"}
            </NavigationMenuItemLabel>
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
          <NavigationMenuLinkItem
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
              <Text size="sm" tone="muted" align="right" className="flex-1 min-w-0 truncate">
                {calendar.unavailableSince ? "Unavailable" : calendar.accountLabel}
              </Text>
            </NavigationMenuItemTrailing>
          </NavigationMenuLinkItem>
        ))}
      </NavigationMenuPopover>
      <AnimatedReveal show={calendars.length > 0} skipInitial={!animateCalendars}>
        <NavigationMenuLinkItem to="/dashboard/events">
          <NavigationMenuItemIcon>
            <CalendarDays size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>View Events</NavigationMenuItemLabel>
          <NavigationMenuItemTrailing>
            {eventCount != null && <Text size="sm" tone="muted">{pluralize(eventCount, "event")}</Text>}
          </NavigationMenuItemTrailing>
        </NavigationMenuLinkItem>
        <NavigationMenuLinkItem to="/dashboard/ical">
          <NavigationMenuItemIcon>
            <Link2 size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>iCal Feeds</NavigationMenuItemLabel>
          <NavigationMenuItemTrailing />
        </NavigationMenuLinkItem>
        <DeletedEventsMenuItem />
      </AnimatedReveal>
    </NavigationMenu>
  );
}

/*
 * The record of originals Keeper.sh deleted is what the deletion consent was given
 * against, so it needs a way in from the dashboard rather than only from the modal that
 * made the promise. It stays hidden until there is something in it: a user who never
 * turned deletions on has no record to read.
 */
function DeletedEventsMenuItem() {
  const { data, error } = useSWR<{ deletions: unknown[] }>("/api/write-back/deletions");
  const deletionCount = error ? 0 : data?.deletions.length ?? 0;

  if (deletionCount === 0) {
    return null;
  }

  return (
    <NavigationMenuLinkItem to="/dashboard/deleted-events">
      <NavigationMenuItemIcon>
        <Trash2 size={15} />
      </NavigationMenuItemIcon>
      <NavigationMenuItemLabel>Deleted Events</NavigationMenuItemLabel>
      <NavigationMenuItemTrailing>
        <Text size="sm" tone="muted">{pluralize(deletionCount, "event")}</Text>
      </NavigationMenuItemTrailing>
    </NavigationMenuLinkItem>
  );
}

function AccountsPopover() {
  const { data: accountsData, isLoading: accountsLoading, error: accountsError, mutate: mutateAccounts } = useAnimatedSWR<CalendarAccount[]>("/api/accounts");
  const accounts = accountsData ?? [];

  return (
    <NavigationMenuPopover
      disabled={accounts.length === 0 && !accountsLoading}
      trigger={
        <>
          <NavigationMenuItemIcon>
            <User size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>
            {accounts.length > 0 ? "Calendar Sources" : "No Calendar Sources"}
          </NavigationMenuItemLabel>
          <NavigationMenuItemTrailing>
            <ProviderIconStack providers={accounts} />
          </NavigationMenuItemTrailing>
        </>
      }
    >
      {accountsError && <ErrorState message="Failed to load accounts." onRetry={() => mutateAccounts()} />}
      {accountsLoading && (
        <div className="flex justify-center py-4">
          <LoaderCircle size={16} className="animate-spin text-foreground-muted" />
        </div>
      )}
      {accounts.map((account) => (
        <NavigationMenuLinkItem
          key={account.id}
          to={`/dashboard/accounts/${account.id}`}
        >
          <NavigationMenuItemIcon>
            <ProviderIcon provider={account.provider} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>{account.accountLabel}</NavigationMenuItemLabel>
          <NavigationMenuItemTrailing />
        </NavigationMenuLinkItem>
      ))}
    </NavigationMenuPopover>
  );
}
