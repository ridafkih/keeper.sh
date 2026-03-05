import { createFileRoute } from "@tanstack/react-router";
import useSWR from "swr";
import { BackButton } from "../../../../components/ui/back-button";
import { RouteShell } from "../../../../components/ui/route-shell";
import { MetadataRow } from "../../../../components/dashboard/metadata-row";
import { apiFetch } from "../../../../lib/fetcher";
import { formatDate } from "../../../../lib/time";
import { getAccountLabel } from "../../../../utils/accounts";
import type { CalendarAccount, CalendarDetail } from "../../../../types/api";
import {
  NavigationMenu,
  NavigationMenuEditableItem,
} from "../../../../components/ui/navigation-menu";
import { DashboardHeading2 } from "../../../../components/ui/dashboard-heading";
import { Text } from "../../../../components/ui/text";

export const Route = createFileRoute(
  "/(dashboard)/dashboard/accounts/$accountId/$calendarId",
)({
  component: CalendarDetailPage,
});

function patchIfPresent<T>(current: T | undefined, patch: Partial<T>): T | undefined {
  if (current) return { ...current, ...patch };
  return current;
}

function CalendarDetailPage() {
  const { accountId, calendarId } = Route.useParams();
  const { data: account, isLoading: accountLoading, error: accountError, mutate: mutateAccount } = useSWR<CalendarAccount>(`/api/accounts/${accountId}`);
  const {
    data: calendar,
    isLoading: calendarLoading,
    error: calendarError,
    mutate: mutateCalendar,
  } = useSWR<CalendarDetail>(`/api/sources/${calendarId}`);

  const isLoading = accountLoading || calendarLoading;
  const error = accountError || calendarError;

  const handleRenameCalendar = async (name: string) => {
    await mutateCalendar(
      async (current) => {
        await apiFetch(`/api/sources/${calendarId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        return patchIfPresent(current, { name });
      },
      {
        optimisticData: patchIfPresent(calendar, { name }),
        rollbackOnError: true,
        revalidate: false,
      },
    );
  };

  if (error || isLoading || !calendar || !account) {
    return <RouteShell backFallback={`/dashboard/accounts/${accountId}`} isLoading={isLoading || !calendar || !account} error={error} onRetry={async () => { await Promise.all([mutateAccount(), mutateCalendar()]); }}>{null}</RouteShell>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <BackButton fallback={`/dashboard/accounts/${accountId}`} />
      <div className="flex flex-col px-0.5 pt-4">
        <DashboardHeading2>Calendar Name</DashboardHeading2>
        <Text size="sm">Click below to rename the calendar within Keeper. This does not affect the calendar outside of the Keeper ecosystem.</Text>
      </div>
      <NavigationMenu>
        <NavigationMenuEditableItem
          value={calendar.name}
          onCommit={handleRenameCalendar}
        />
      </NavigationMenu>
      <div className="flex flex-col px-0.5 pt-4">
        <DashboardHeading2>Calendar Information</DashboardHeading2>
        <Text size="sm">View details about the calendar.</Text>
      </div>
      <NavigationMenu>
        <MetadataRow label="Resource Type" value="Calendar" />
        <MetadataRow label="Type" value={calendar.calendarType} />
        <MetadataRow label="Capabilities" value={calendar.capabilities.join(", ")} />
        {calendar.url && (
          <MetadataRow label="URL" value={calendar.url} truncate />
        )}
        {calendar.calendarUrl && (
          <MetadataRow label="Calendar URL" value={calendar.calendarUrl} truncate />
        )}
        <MetadataRow label="Added" value={formatDate(calendar.createdAt)} />
        <MetadataRow
          label="Account"
          value={getAccountLabel(account)}
          truncate
          to={`/dashboard/accounts/${accountId}`}
        />
      </NavigationMenu>
    </div>
  );
}
