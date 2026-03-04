import { createFileRoute } from "@tanstack/react-router";
import useSWR from "swr";
import { BackButton } from "../../../../components/ui/back-button";
import { RouteShell } from "../../../../components/ui/route-shell";
import { Text } from "../../../../components/ui/text";
import { apiFetch } from "../../../../lib/fetcher";
import { getAccountLabel } from "../../../../utils/accounts";
import type { CalendarAccount, CalendarDetail } from "../../../../types/api";
import {
  NavigationMenu,
  NavigationMenuEditableItem,
  NavigationMenuItem,
} from "../../../../components/ui/navigation-menu";

export const Route = createFileRoute(
  "/(dashboard)/dashboard/accounts/$accountId/$calendarId",
)({
  component: RouteComponent,
});

function RouteComponent() {
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

  if (error || isLoading || !calendar || !account) {
    return <RouteShell backFallback={`/dashboard/accounts/${accountId}`} isLoading={isLoading || !calendar || !account} error={error} onRetry={async () => { await Promise.all([mutateAccount(), mutateCalendar()]); }}>{null}</RouteShell>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <BackButton fallback={`/dashboard/accounts/${accountId}`} />
      <NavigationMenu>
        <NavigationMenuEditableItem
          value={calendar.name}
          onCommit={async (name) => {
            await mutateCalendar(
              async (current) => {
                await apiFetch(`/api/sources/${calendarId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name }),
                });
                return current ? { ...current, name } : current;
              },
              {
                optimisticData: { ...calendar, name },
                rollbackOnError: true,
                revalidate: false,
              },
            );
          }}
        />
      </NavigationMenu>
      <NavigationMenu>
        <NavigationMenuItem>
          <Text size="sm" tone="muted" className="shrink-0">Resource Type</Text>
          <Text size="sm" tone="muted">Calendar</Text>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <Text size="sm" tone="muted" className="shrink-0">Type</Text>
          <Text size="sm" tone="muted">{calendar.calendarType}</Text>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <Text size="sm" tone="muted" className="shrink-0">Capabilities</Text>
          <Text size="sm" tone="muted">{calendar.capabilities.join(", ")}</Text>
        </NavigationMenuItem>
        {calendar.url && (
          <NavigationMenuItem>
            <Text size="sm" tone="muted" className="shrink-0">URL</Text>
            <div className="min-w-0">
              <Text size="sm" tone="muted" className="truncate">{calendar.url}</Text>
            </div>
          </NavigationMenuItem>
        )}
        {calendar.calendarUrl && (
          <NavigationMenuItem>
            <Text size="sm" tone="muted" className="shrink-0">Calendar URL</Text>
            <div className="min-w-0">
              <Text size="sm" tone="muted" className="truncate">{calendar.calendarUrl}</Text>
            </div>
          </NavigationMenuItem>
        )}
        <NavigationMenuItem>
          <Text size="sm" tone="muted" className="shrink-0">Added</Text>
          <Text size="sm" tone="muted">{new Date(calendar.createdAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</Text>
        </NavigationMenuItem>
        <NavigationMenuItem to={`/dashboard/accounts/${accountId}`}>
          <Text size="sm" tone="muted" className="shrink-0">Account</Text>
          <div className="min-w-0">
            <Text size="sm" tone="muted" className="truncate">{getAccountLabel(account)}</Text>
          </div>
        </NavigationMenuItem>
      </NavigationMenu>
    </div>
  );
}
