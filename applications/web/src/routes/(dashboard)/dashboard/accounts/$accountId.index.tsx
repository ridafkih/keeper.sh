import { useEffect, useMemo, useState, useTransition } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import useSWR, { preload, useSWRConfig } from "swr";
import Calendar from "lucide-react/dist/esm/icons/calendar";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import { BackButton } from "@/components/ui/primitives/back-button";
import { Pagination, PaginationPrevious, PaginationNext } from "@/components/ui/primitives/pagination";
import { RouteShell } from "@/components/ui/shells/route-shell";
import { Text } from "@/components/ui/primitives/text";
import { MetadataRow } from "@/features/dashboard/components/metadata-row";
import { fetcher, apiFetch } from "@/lib/fetcher";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { formatDate } from "@/lib/time";
import { invalidateAccountsAndSources } from "@/lib/swr";
import type { CalendarAccount, CalendarSource } from "@/types/api";
import {
  NavigationMenu,
  NavigationMenuEmptyItem,
  NavigationMenuButtonItem,
  NavigationMenuLinkItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { DeleteConfirmation } from "@/components/ui/primitives/delete-confirmation";
import { DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { pluralize } from "@/lib/pluralize";
import { resolveErrorMessage } from "@/utils/errors";

export const Route = createFileRoute(
  "/(dashboard)/dashboard/accounts/$accountId/",
)({
  component: AccountDetailPage,
});

function CalendarList({ calendars, accountId }: { calendars: CalendarSource[]; accountId: string }) {
  if (calendars.length === 0) {
    return <NavigationMenuEmptyItem>No calendars</NavigationMenuEmptyItem>;
  }
  return calendars.map((calendar) => (
    <NavigationMenuLinkItem
      key={calendar.id}
      to={`/dashboard/accounts/${accountId}/${calendar.id}`}
      onMouseEnter={() => preload(`/api/sources/${calendar.id}`, fetcher)}
    >
      <NavigationMenuItemIcon>
        <Calendar size={15} />
      </NavigationMenuItemIcon>
      <NavigationMenuItemLabel>
        {calendar.name}
        {calendar.providerMissingSince && (
          <Text as="span" size="sm" tone="danger"> (not found at provider)</Text>
        )}
      </NavigationMenuItemLabel>
      <NavigationMenuItemTrailing>
        {calendar.unavailableSince && <Text size="sm" tone="muted">Unavailable</Text>}
      </NavigationMenuItemTrailing>
    </NavigationMenuLinkItem>
  ));
}

function RefreshCalendarsItem({ accountId }: { accountId: string }) {
  const { mutate: globalMutate } = useSWRConfig();
  const [isRefreshing, startRefreshTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const handleRefresh = () => {
    setResult(null);
    setRefreshError(null);

    startRefreshTransition(async () => {
      try {
        const response = await apiFetch(`/api/accounts/${accountId}/refresh`, { method: "POST" });
        const body: { imported: number; missing: number; restored: number } = await response.json();
        track(ANALYTICS_EVENTS.calendar_account_refreshed, {
          imported: body.imported,
          missing: body.missing,
          restored: body.restored,
        });
        setResult(
          `${pluralize(body.imported, "new calendar")} imported, `
          + `${pluralize(body.missing, "calendar")} not found at the provider, `
          + `${pluralize(body.restored, "calendar")} back.`,
        );
        await invalidateAccountsAndSources(globalMutate, `/api/accounts/${accountId}`);
      } catch (err) {
        setRefreshError(resolveErrorMessage(err, "Failed to refresh calendars."));
      }
    });
  };

  return (
    <>
      <NavigationMenuButtonItem onClick={handleRefresh} disabled={isRefreshing}>
        <Text size="sm">{isRefreshing ? "Refreshing…" : "Refresh Calendars"}</Text>
      </NavigationMenuButtonItem>
      {result && <Text size="sm" tone="muted" className="px-0.5">{result}</Text>}
      {refreshError && <Text size="sm" tone="danger" className="px-0.5">{refreshError}</Text>}
    </>
  );
}

function AccountDetailPage() {
  const { accountId } = Route.useParams();
  const navigate = useNavigate();
  const { mutate: globalMutate } = useSWRConfig();
  const { data: account, isLoading: accountLoading, error: accountError } = useSWR<CalendarAccount>(
    `/api/accounts/${accountId}`,
  );
  const { data: allCalendars, isLoading: calendarsLoading, error: calendarsError } = useSWR<CalendarSource[]>(
    "/api/sources",
  );

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isLoading = accountLoading || calendarsLoading;
  const error = accountError || calendarsError;

  const handleConfirmDelete = () => {
    setDeleteError(null);

    startDeleteTransition(async () => {
      try {
        await apiFetch(`/api/accounts/${accountId}`, { method: "DELETE" });
        if (account) {
          track(ANALYTICS_EVENTS.calendar_account_deleted, { provider: account.provider });
        }
        await invalidateAccountsAndSources(globalMutate, `/api/accounts/${accountId}`);
        navigate({ to: "/dashboard" });
      } catch (err) {
        setDeleteError(resolveErrorMessage(err, "Failed to delete account."));
      }
    });
  };

  if (error || isLoading || !account) {
    if (error) return <RouteShell status="error" onRetry={async () => { await invalidateAccountsAndSources(globalMutate, `/api/accounts/${accountId}`); }} />;
    return <RouteShell status="loading" />;
  }

  const calendars = (allCalendars ?? []).filter(
    (calendar) => calendar.accountId === accountId,
  );

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <BackButton />
        <AccountPrevNext accountId={accountId} />
      </div>
      <DashboardSection
        title="Account Information"
        description="View details about the account and its calendars."
      />
      <NavigationMenu>
        <MetadataRow label="Resource Type" value="Account" />
        <MetadataRow label="Calendar Count" value={String(calendars.length)} />
        <MetadataRow label="Identifier" value={account.accountIdentifier ?? ""} truncate />
        <MetadataRow label="Provider" value={account.providerName} />
        <MetadataRow label="Authenticated" value={account.authType} />
        <MetadataRow label="Connected" value={formatDate(account.createdAt)} />
        {account.calendarsRefreshedAt && (
          <MetadataRow label="Calendars Checked" value={formatDate(account.calendarsRefreshedAt)} />
        )}
      </NavigationMenu>
      <NavigationMenu>
        <RefreshCalendarsItem accountId={accountId} />
      </NavigationMenu>
      <DashboardSection
        title="Account Calendars"
        description={<>This account has {pluralize(calendars.length, "calendar")} attached to it, choose a calendar below to view more details and configure it. Calendars no longer found at the provider are noted below.</>}
      />
      <NavigationMenu>
        <CalendarList calendars={calendars} accountId={accountId} />
      </NavigationMenu>
      <NavigationMenu>
        <NavigationMenuButtonItem onClick={() => setDeleteOpen(true)}>
          <NavigationMenuItemIcon>
            <Trash2 size={15} className="text-destructive" />
          </NavigationMenuItemIcon>
          <Text size="sm" tone="danger">Delete Account</Text>
        </NavigationMenuButtonItem>
      </NavigationMenu>
      {deleteError && <Text size="sm" tone="danger">{deleteError}</Text>}
      <DeleteConfirmation
        title="Delete calendar account?"
        description="This will remove the account and all its calendars. Any sync profiles using these calendars will be affected."
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        deleting={isDeleting}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

function AccountPrevNext({ accountId }: { accountId: string }) {
  const { data: accounts } = useSWR<CalendarAccount[]>("/api/accounts");

  const currentIndex = useMemo(
    () => (accounts ?? []).findIndex((a) => a.id === accountId),
    [accounts, accountId],
  );

  const prev = accounts && currentIndex > 0 ? accounts[currentIndex - 1] : null;
  const next = accounts && currentIndex < accounts.length - 1 ? accounts[currentIndex + 1] : null;

  useEffect(() => {
    if (prev) preload(`/api/accounts/${prev.id}`, fetcher);
    if (next) preload(`/api/accounts/${next.id}`, fetcher);
  }, [prev, next]);

  if (!accounts || accounts.length <= 1) return null;

  return (
    <Pagination>
      <PaginationPrevious to={prev ? `/dashboard/accounts/${prev.id}` : undefined} />
      <PaginationNext to={next ? `/dashboard/accounts/${next.id}` : undefined} />
    </Pagination>
  );
}
