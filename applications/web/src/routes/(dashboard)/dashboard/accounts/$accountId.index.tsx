import { useEffect, useMemo, useState, useTransition } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import useSWR, { preload, useSWRConfig } from "swr";
import Calendar from "lucide-react/dist/esm/icons/calendar";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
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
import { Button, ButtonText } from "@/components/ui/primitives/button";
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalTitle,
} from "@/components/ui/primitives/modal";
import { pluralize } from "@/lib/pluralize";
import { resolveErrorMessage } from "@/utils/errors";
import {
  buildSetupSearchForNewCalendars,
  formatRefreshSummary,
  refreshCalendarsResponseSchema,
} from "@/features/dashboard/components/refresh-summary";
import type { RefreshCalendarsResponse } from "@/features/dashboard/components/refresh-summary";

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
      </NavigationMenuItemLabel>
      <NavigationMenuItemTrailing>
        {calendar.unavailableSince && <Text size="sm" tone="muted">Unavailable</Text>}
      </NavigationMenuItemTrailing>
    </NavigationMenuLinkItem>
  ));
}

function RefreshResultModal({
  accountId,
  result,
  onDismiss,
}: {
  accountId: string;
  result: RefreshCalendarsResponse | null;
  onDismiss: () => void;
}) {
  const navigate = useNavigate();
  const setupSearch = result && buildSetupSearchForNewCalendars(result.added.map(({ id }) => id));

  const goToSetup = () => {
    if (!setupSearch) return;
    onDismiss();
    navigate({
      to: "/dashboard/accounts/$accountId/setup",
      params: { accountId },
      search: setupSearch,
    });
  };

  return (
    <Modal open={!!result} onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <ModalContent>
        <ModalTitle>Calendars refreshed</ModalTitle>
        <ModalDescription>
          {result && formatRefreshSummary({
            added: result.added.length,
            revived: result.revived,
            unavailable: result.unavailable,
          })}
        </ModalDescription>
        <ModalFooter>
          {setupSearch && (
            <Button className="w-full justify-center" onClick={goToSetup}>
              <ButtonText>Set Up New Calendars</ButtonText>
            </Button>
          )}
          <Button variant="elevated" className="w-full justify-center" onClick={onDismiss}>
            <ButtonText>Done</ButtonText>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
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
  const [isRefreshing, startRefreshTransition] = useTransition();
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshResult, setRefreshResult] = useState<RefreshCalendarsResponse | null>(null);

  const isLoading = accountLoading || calendarsLoading;
  const error = accountError || calendarsError;

  const handleRefreshCalendars = () => {
    setRefreshError(null);
    setRefreshResult(null);

    startRefreshTransition(async () => {
      try {
        const response = await apiFetch(`/api/accounts/${accountId}/refresh-calendars`, {
          method: "POST",
        });
        const result = refreshCalendarsResponseSchema.assert(await response.json());
        if (account) {
          track(ANALYTICS_EVENTS.calendar_account_refreshed, { provider: account.provider });
        }
        await invalidateAccountsAndSources(globalMutate, `/api/accounts/${accountId}`);
        setRefreshResult(result);
      } catch (err) {
        setRefreshError(resolveErrorMessage(err, "Failed to refresh calendars."));
      }
    });
  };

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
        {account.authType !== "none" && (
          <NavigationMenuButtonItem
            onClick={isRefreshing ? undefined : handleRefreshCalendars}
            disabled={isRefreshing}
          >
            <NavigationMenuItemIcon>
              <RefreshCw size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>
              {isRefreshing ? "Refreshing..." : "Refresh Calendars"}
            </NavigationMenuItemLabel>
          </NavigationMenuButtonItem>
        )}
        <NavigationMenuButtonItem onClick={() => setDeleteOpen(true)}>
          <Text size="sm" tone="danger">Delete Account</Text>
        </NavigationMenuButtonItem>
      </NavigationMenu>
      {refreshError && <Text size="sm" tone="danger">{refreshError}</Text>}
      <DashboardSection
        title="Account Calendars"
        description={<>This account has {pluralize(calendars.length, "calendar")} attached to it, choose a calendar below to view more details and configure it.</>}
      />
      <NavigationMenu>
        <CalendarList calendars={calendars} accountId={accountId} />
      </NavigationMenu>
      {deleteError && <Text size="sm" tone="danger">{deleteError}</Text>}
      <RefreshResultModal
        accountId={accountId}
        result={refreshResult}
        onDismiss={() => setRefreshResult(null)}
      />
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
