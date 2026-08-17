import { createFileRoute } from "@tanstack/react-router";
import useSWR from "swr";
import { BackButton } from "@/components/ui/primitives/back-button";
import { DashboardHeading1 } from "@/components/ui/primitives/dashboard-heading";
import { Text } from "@/components/ui/primitives/text";
import { RouteShell } from "@/components/ui/shells/route-shell";
import { TwoWaySyncSections } from "@/features/dashboard/components/two-way-sync-sections";
import type { CalendarDetail } from "@/types/api";

export const Route = createFileRoute(
  "/(dashboard)/dashboard/accounts/$accountId/$calendarId_/two-way",
)({
  component: TwoWaySyncPage,
});

function TwoWaySyncPage() {
  const { accountId, calendarId } = Route.useParams();
  const { data: calendar, isLoading, error, mutate } = useSWR<CalendarDetail>(
    `/api/sources/${calendarId}`,
  );

  const backTo = `/dashboard/accounts/${accountId}/${calendarId}`;

  if (error) {
    return <RouteShell backFallback={backTo} status="error" onRetry={() => { void mutate(); }} />;
  }

  if (isLoading || !calendar) {
    return <RouteShell backFallback={backTo} status="loading" />;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <BackButton fallback={backTo} />
      <div className="flex flex-col px-0.5 pt-4">
        <DashboardHeading1>Two-Way Syncing</DashboardHeading1>
        <Text size="sm">
          {`Changes made to a copy can be written back to ${calendar.name}. Choose what each connected calendar is allowed to do.`}
        </Text>
      </div>
      <TwoWaySyncSections calendarId={calendarId} />
    </div>
  );
}
