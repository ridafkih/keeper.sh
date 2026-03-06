import { useState, useTransition } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import useSWR, { preload, useSWRConfig } from "swr";
import { Calendar } from "lucide-react";
import { BackButton } from "../../../../components/ui/back-button";
import { RouteShell } from "../../../../components/ui/route-shell";
import { Text } from "../../../../components/ui/text";
import { MetadataRow } from "../../../../components/dashboard/metadata-row";
import { fetcher, apiFetch } from "../../../../lib/fetcher";
import { formatDate } from "../../../../lib/time";
import { invalidateAccountsAndSources } from "../../../../lib/swr";
import { getAccountLabel } from "../../../../utils/accounts";
import type { CalendarAccount, CalendarSource } from "../../../../types/api";
import {
  NavigationMenu,
  NavigationMenuEmptyItem,
  NavigationMenuItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "../../../../components/ui/navigation-menu";
import { DeleteConfirmation } from "../../../../components/ui/delete-confirmation";
import { DashboardHeading2 } from "../../../../components/ui/dashboard-heading";
import { pluralize } from "../../../../lib/pluralize";

export const Route = createFileRoute(
  "/(dashboard)/dashboard/accounts/$accountId/",
)({
  component: AccountDetailPage,
});

function resolveErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  return fallback;
}

function renderCalendarList(calendars: CalendarSource[], accountId: string) {
  if (calendars.length === 0) {
    return <NavigationMenuEmptyItem>No calendars</NavigationMenuEmptyItem>;
  }
  return calendars.map((calendar) => (
    <NavigationMenuItem
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
      <NavigationMenuItemTrailing />
    </NavigationMenuItem>
  ));
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
        await invalidateAccountsAndSources(globalMutate, `/api/accounts/${accountId}`);
        navigate({ to: "/dashboard" });
      } catch (err) {
        setDeleteError(resolveErrorMessage(err, "Failed to delete account."));
      }
    });
  };

  if (error || isLoading || !account) {
    return <RouteShell isLoading={isLoading || !account} error={error} onRetry={async () => { await invalidateAccountsAndSources(globalMutate, `/api/accounts/${accountId}`); }}>{null}</RouteShell>;
  }

  const calendars = (allCalendars ?? []).filter(
    (calendar) => calendar.accountId === accountId,
  );

  return (
    <div className="flex flex-col gap-1.5">
      <BackButton />
      <div className="flex flex-col px-0.5 pt-4">
        <DashboardHeading2>Account Information</DashboardHeading2>
        <Text size="sm">View details about the account and its calendars.</Text>
      </div>
      <NavigationMenu>
        <MetadataRow label="Resource Type" value="Account" />
        <MetadataRow label="Calendar Count" value={String(calendars.length)} />
        <MetadataRow label="Identifier" value={getAccountLabel(account)} truncate />
        <MetadataRow label="Provider" value={account.provider} />
        <MetadataRow label="Authenticated" value={account.authType} />
        <MetadataRow label="Connected" value={formatDate(account.createdAt)} />
      </NavigationMenu>
      <NavigationMenu>
        <NavigationMenuItem onClick={() => setDeleteOpen(true)}>
          <Text size="sm" tone="danger">Delete Account</Text>
        </NavigationMenuItem>
      </NavigationMenu>
      <div className="flex flex-col px-0.5 pt-4">
        <DashboardHeading2>Account Calendars</DashboardHeading2>
        <Text size="sm">This account has {pluralize(calendars.length, "calendar")} attached to it, choose a calendar below to view more details and configure it.</Text>
      </div>
      <NavigationMenu>
        {renderCalendarList(calendars, accountId)}
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
