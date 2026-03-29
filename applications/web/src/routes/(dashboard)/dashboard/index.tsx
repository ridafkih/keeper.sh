import { createFileRoute, useNavigate } from "@tanstack/react-router";
import useSWR, { preload } from "swr";
import { AnimatedReveal } from "@/components/ui/primitives/animated-reveal";
import Calendar from "lucide-react/dist/esm/icons/calendar";
import CalendarPlus from "lucide-react/dist/esm/icons/calendar-plus";
import CalendarDays from "lucide-react/dist/esm/icons/calendar-days";
import Link2 from "lucide-react/dist/esm/icons/link-2";
import Settings from "lucide-react/dist/esm/icons/settings";
import LogOut from "lucide-react/dist/esm/icons/log-out";
import MessageSquare from "lucide-react/dist/esm/icons/message-square";
import Bug from "lucide-react/dist/esm/icons/bug";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import User from "lucide-react/dist/esm/icons/user";
import { ErrorState } from "@/components/ui/primitives/error-state";
import { signOut } from "@/lib/auth";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { fetcher } from "@/lib/fetcher";
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
import Zap from "lucide-react/dist/esm/icons/zap";
import { SyncStatus } from "@/features/dashboard/components/sync-status";
import { useEntitlements } from "@/hooks/use-entitlements";
import { PremiumFeatureGate } from "@/components/ui/primitives/upgrade-hint";
import { getCommercialMode } from "@/config/commercial";

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
      <div className="flex flex-col gap-1">
        <SubscribeCTA />
        <NavigationMenu>
          <NavigationMenuLinkItem to="/dashboard/connect">
            <NavigationMenuItemIcon>
              <CalendarPlus size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>Import Calendars</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing />
          </NavigationMenuLinkItem>
        </NavigationMenu>
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
                {calendar.accountLabel}
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
          <NavigationMenuItemLabel>iCal Link</NavigationMenuItemLabel>
          <NavigationMenuItemTrailing />
        </NavigationMenuLinkItem>
      </AnimatedReveal>
    </NavigationMenu>
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

function getTrialDaysLeft(endsAt: string): number {
  const msLeft = new Date(endsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(msLeft / 86_400_000));
}

function pluralDay(count: number): string {
  if (count === 1) {
    return "Day";
  }
  return "Days";
}

function resolveSubscribeLabel(plan: string | null | undefined, trial: { endsAt: string } | null | undefined): string | null {
  if (trial) {
    const daysLeft = getTrialDaysLeft(trial.endsAt);
    return `Click to Upgrade (${daysLeft} ${[pluralDay(daysLeft)]} Trial Left)`;
  }
  if (!plan) {
    return "Click to Upgrade (Trial Expired)";
  }
  return null;
}

function SubscribeCTA() {
  const { data: entitlements } = useEntitlements();

  if (!getCommercialMode()) return null;

  const label = resolveSubscribeLabel(entitlements?.plan, entitlements?.trial);

  if (!label) return null;

  return (
    <PremiumFeatureGate interactive locked footer={<Text size="sm" align="center">Your free trial has ended. Click to upgrade!</Text>}>
      <NavigationMenu variant="highlight">
        <NavigationMenuLinkItem to="/dashboard/upgrade">
          <NavigationMenuItemIcon>
            <Zap size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>{label}</NavigationMenuItemLabel>
          <NavigationMenuItemTrailing />
        </NavigationMenuLinkItem>
      </NavigationMenu>
    </PremiumFeatureGate>
  );
}
