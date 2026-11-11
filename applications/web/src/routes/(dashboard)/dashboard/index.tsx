import { useEffect, useState, useTransition } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import useSWR, { preload, SWRConfig, useSWRConfig } from "swr";
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
import TriangleAlert from "lucide-react/dist/esm/icons/triangle-alert";
import { useReauthAccounts } from "@/features/dashboard/components/reauth/use-reauth-accounts";
import { DashboardReauthNotice } from "@/features/dashboard/components/reauth/reauth-notice";
import { useSubscription, fetchSubscriptionStateWithApi } from "@/hooks/use-subscription";
import { useHasConfiguredSync } from "@/hooks/use-entitlements";
import { PlanMenuItem } from "@/features/dashboard/components/plan-menu";
import { isPlanShownOnHome } from "@/features/dashboard/components/plan-placement";
import { useOnboarding } from "@/features/onboarding/use-onboarding";
import { useSyncPairs } from "@/features/onboarding/use-sync-pairs";
import { Onboarding } from "@/features/onboarding/components/onboarding";
import { SyncPairRow } from "@/features/onboarding/components/sync-pair-row";
import { USAGE_CACHE_KEY } from "@/hooks/use-entitlements";
import { showToastAtom } from "@/state/toast";
import { useSetAtom } from "jotai";

async function loadSubscription(context: {
  fetchApi: <T>(path: string, init?: RequestInit) => Promise<T>;
  runtimeConfig: { commercialMode: boolean };
}) {
  if (!context.runtimeConfig.commercialMode) return undefined;
  try {
    return await fetchSubscriptionStateWithApi(context.fetchApi);
  } catch (error) {
    console.error("[subscription] dashboard loader preload failed, deferring to the client read:", error);
    return undefined;
  }
}

const SETUP_DATA_PATHS = ["/api/sources", "/api/accounts", USAGE_CACHE_KEY, "/api/mappings"] as const;

async function loadSetupData(context: {
  fetchApi: <T>(path: string, init?: RequestInit) => Promise<T>;
}): Promise<Record<string, unknown>> {
  const entries = await Promise.all(SETUP_DATA_PATHS.map(async (path) => {
    try {
      return [[path, await context.fetchApi<unknown>(path)]];
    } catch (error) {
      console.error(`[setup] dashboard loader preload of ${path} failed, deferring to the client read:`, error);
      return [];
    }
  }));
  return Object.fromEntries(entries.flat());
}

interface DashboardSearch {
  connected?: string;
}

export const Route = createFileRoute("/(dashboard)/dashboard/")({
  validateSearch: (search: Record<string, unknown>): DashboardSearch => ({
    connected: typeof search.connected === "string" ? search.connected : undefined,
  }),
  loader: async ({ context }) => {
    const [subscription, setupData] = await Promise.all([loadSubscription(context), loadSetupData(context)]);
    return { commercialMode: context.runtimeConfig.commercialMode, setupData, subscription };
  },
  component: DashboardPage,
});

function DashboardPage() {
  const { setupData } = Route.useLoaderData();
  return (
    <SWRConfig value={{ fallback: setupData }}>
      <DashboardContent />
    </SWRConfig>
  );
}

function useConnectedToast(accounts: CalendarAccount[] | undefined) {
  const { connected } = Route.useSearch();
  const navigate = useNavigate();
  const showToast = useSetAtom(showToastAtom);
  const account = accounts?.find(({ id }) => id === connected);

  useEffect(() => {
    if (!connected || !accounts) return;
    if (account) showToast(`${account.providerName} connected`);
    navigate({ replace: true, search: {}, to: "/dashboard" });
  }, [connected, accounts, account, showToast, navigate]);
}

function DashboardContent() {
  const onboarding = useOnboarding();
  useConnectedToast(onboarding?.accounts);

  if (!onboarding) return null;
  if (onboarding.step !== "home") return <Onboarding state={onboarding} />;
  return <Home />;
}

function Home() {
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
        <DashboardReauthNotice />
        <CalendarsMenu />
        <SyncPairsMenu />
        <PlanMenu />
        <NavigationMenu>
          <NavigationMenuLinkItem to="/dashboard/feedback">
            <NavigationMenuItemIcon>
              <MessageSquare size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>Submit feedback</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing />
          </NavigationMenuLinkItem>
          <NavigationMenuLinkItem to="/dashboard/report">
            <NavigationMenuItemIcon>
              <Bug size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>Report a problem</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing />
          </NavigationMenuLinkItem>
        </NavigationMenu>
        <AccountsMenu onLogout={handleLogout} />
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

function PlanMenu() {
  const { commercialMode, subscription: loaderSubscription } = Route.useLoaderData();
  const { data: subscription, isLoading: subscriptionLoading } = useSubscription({
    fallbackData: loaderSubscription,
  });
  const isPro = subscription?.plan === "pro";
  const hasConfiguredSync = useHasConfiguredSync();

  if (!commercialMode || !isPlanShownOnHome({ isPro, hasConfiguredSync })) {
    return null;
  }

  return (
    <NavigationMenu variant={isPro ? "default" : "highlight"}>
      <PlanMenuItem subscription={subscription} subscriptionLoading={subscriptionLoading} />
    </NavigationMenu>
  );
}

function useRefreshCalendars() {
  const { mutate: globalMutate } = useSWRConfig();
  const [isRefreshing, startRefreshTransition] = useTransition();
  const [status, setStatus] = useState<RefreshStatus | null>(null);
  const { secondsRemaining, start: startCooldown } = useCountdown();

  const refresh = () => {
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

  return { isRefreshing, refresh, secondsRemaining, status };
}

function SyncPairsMenu() {
  const { data: calendars } = useSWR<CalendarSource[]>("/api/sources");
  const pairs = useSyncPairs(calendars);
  if (pairs.length === 0) return null;

  return (
    <NavigationMenu>
      {pairs.map(({ pair, source }) => <SyncPairRow key={pair.key} pair={pair} source={source} />)}
    </NavigationMenu>
  );
}

function AttentionDot() {
  return (
    <span className="size-1.5 shrink-0 rounded-full bg-linear-to-b from-amber-400 to-amber-500" />
  );
}

function CalendarsMenu() {
  const reauthIds = new Set(useReauthAccounts().map((account) => account.id));
  const { data: calendarsData, shouldAnimate: animateCalendars, isLoading: calendarsLoading, error, mutate: mutateCalendars } = useAnimatedSWR<CalendarSource[]>("/api/sources");
  const calendars = calendarsData ?? [];

  const { data: eventCountData, error: eventCountError } = useSWR<{ count: number }>("/api/events/count");
  const eventCount = eventCountError ? undefined : eventCountData?.count;

  const { isRefreshing, refresh, secondsRemaining, status } = useRefreshCalendars();
  const isCoolingDown = secondsRemaining > 0;

  return (
    <>
      <NavigationMenu>
        <NavigationMenuPopover
          disabled={calendars.length === 0 && !calendarsLoading}
          trigger={
            <>
              <NavigationMenuItemIcon>
                <Calendar size={15} />
              </NavigationMenuItemIcon>
              <NavigationMenuItemLabel>
                {calendars.length > 0 ? "Calendars" : "No calendars"}
              </NavigationMenuItemLabel>
              <NavigationMenuItemTrailing>
                <ProviderIconStack
                  providers={calendars}
                  leading={
                    calendars.some((calendar) => reauthIds.has(calendar.accountId))
                      ? <AttentionDot />
                      : undefined
                  }
                />
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
              <NavigationMenuItemLabel
                className="shrink-0"
                tone={reauthIds.has(calendar.accountId) ? "attention" : undefined}
              >
                {calendar.name}
              </NavigationMenuItemLabel>
              <NavigationMenuItemTrailing
                className="overflow-hidden"
                indicator={
                  reauthIds.has(calendar.accountId)
                    ? <TriangleAlert size={15} className="shrink-0 text-attention" />
                    : undefined
                }
              >
                <Text
                  size="sm"
                  tone={reauthIds.has(calendar.accountId) ? "attention" : "muted"}
                  align="right"
                  className="flex-1 min-w-0 truncate"
                >
                  {calendar.unavailableSince ? "Unavailable" : calendar.accountLabel}
                </Text>
              </NavigationMenuItemTrailing>
            </NavigationMenuLinkItem>
          ))}
        </NavigationMenuPopover>
        <NavigationMenuLinkItem to="/dashboard/connect">
          <NavigationMenuItemIcon>
            <CalendarPlus size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>Add a calendar</NavigationMenuItemLabel>
          <NavigationMenuItemTrailing />
        </NavigationMenuLinkItem>
        <NavigationMenuButtonItem
          onClick={isRefreshing || isCoolingDown ? undefined : refresh}
          disabled={isRefreshing || isCoolingDown}
        >
          <NavigationMenuItemIcon>
            <RefreshCw size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>
            {isRefreshing ? "Refreshing..." : "Refresh calendars"}
          </NavigationMenuItemLabel>
          <NavigationMenuItemTrailing>
            {isCoolingDown && <Text size="sm" tone="muted">{secondsRemaining}s</Text>}
          </NavigationMenuItemTrailing>
        </NavigationMenuButtonItem>
        <AnimatedReveal show={calendars.length > 0} skipInitial={!animateCalendars}>
          <NavigationMenuLinkItem to="/dashboard/events">
            <NavigationMenuItemIcon>
              <CalendarDays size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>View events</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing>
              {eventCount != null && <Text size="sm" tone="muted">{pluralize(eventCount, "event")}</Text>}
            </NavigationMenuItemTrailing>
          </NavigationMenuLinkItem>
          <NavigationMenuLinkItem to="/dashboard/ical">
            <NavigationMenuItemIcon>
              <Link2 size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>iCal feeds</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing />
          </NavigationMenuLinkItem>
        </AnimatedReveal>
      </NavigationMenu>
      {status && <Text size="sm" tone={status.tone}>{status.message}</Text>}
    </>
  );
}

function AccountsMenu({ onLogout }: { onLogout: () => void }) {
  const reauthAccounts = useReauthAccounts();
  const reauthIds = new Set(reauthAccounts.map((account) => account.id));
  return (
    <NavigationMenu>
      <AccountsPopover reauthIds={reauthIds} />
      <NavigationMenuLinkItem to="/dashboard/settings">
        <NavigationMenuItemIcon>
          <Settings size={15} />
        </NavigationMenuItemIcon>
        <NavigationMenuItemLabel>Settings</NavigationMenuItemLabel>
        <NavigationMenuItemTrailing />
      </NavigationMenuLinkItem>
      <NavigationMenuButtonItem onClick={onLogout}>
        <NavigationMenuItemIcon>
          <LogOut size={15} />
        </NavigationMenuItemIcon>
        <NavigationMenuItemLabel>Log out</NavigationMenuItemLabel>
      </NavigationMenuButtonItem>
    </NavigationMenu>
  );
}

function AccountsPopover({ reauthIds }: { reauthIds: Set<string> }) {
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
            {accounts.length > 0 ? "Calendar sources" : "No calendar sources"}
          </NavigationMenuItemLabel>
          <NavigationMenuItemTrailing>
            <ProviderIconStack
              providers={accounts}
              leading={
                reauthIds.size > 0
                  ? <AttentionDot />
                  : undefined
              }
            />
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
      {accounts.map((account) => {
        const needsReauth = reauthIds.has(account.id);
        return (
          <NavigationMenuLinkItem
            key={account.id}
            to={`/dashboard/accounts/${account.id}`}
          >
            <NavigationMenuItemIcon>
              <ProviderIcon provider={account.provider} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel tone={needsReauth ? "attention" : undefined}>
              {account.accountLabel}
            </NavigationMenuItemLabel>
            <NavigationMenuItemTrailing
              indicator={
                needsReauth ? (
                  <TriangleAlert
                    size={15}
                    className="shrink-0 text-amber-600 dark:text-amber-400"
                  />
                ) : undefined
              }
            />
          </NavigationMenuLinkItem>
        );
      })}
    </NavigationMenuPopover>
  );
}
