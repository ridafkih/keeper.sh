import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import useSWR, { preload, useSWRConfig } from "swr";
import { Calendar } from "lucide-react";
import { BackButton } from "../../../../components/ui/back-button";
import { RouteShell } from "../../../../components/ui/route-shell";
import { Text } from "../../../../components/ui/text";
import { fetcher, apiFetch } from "../../../../lib/fetcher";
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

export const Route = createFileRoute(
  "/(dashboard)/dashboard/accounts/$accountId/",
)({
  component: RouteComponent,
});

function RouteComponent() {
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
  const [deleting, setDeleting] = useState(false);

  const isLoading = accountLoading || calendarsLoading;
  const error = accountError || calendarsError;

  if (error || isLoading || !account) {
    return <RouteShell isLoading={isLoading || !account} error={error} onRetry={async () => { await invalidateAccountsAndSources(globalMutate, `/api/accounts/${accountId}`); }}>{null}</RouteShell>;
  }

  const calendars = (allCalendars ?? []).filter(
    (calendar) => calendar.accountId === accountId,
  );

  return (
    <div className="flex flex-col gap-1.5">
      <BackButton />
      <NavigationMenu>
        {calendars.length === 0 ? (
          <NavigationMenuEmptyItem>No calendars</NavigationMenuEmptyItem>
        ) : (
          calendars.map((calendar) => (
            <NavigationMenuItem
              key={calendar.id}
              to={`/dashboard/accounts/${accountId}/${calendar.id}`}
              onMouseEnter={() => preload(`/api/sources/${calendar.id}`, fetcher)}
            >
              <NavigationMenuItemIcon>
                <Calendar size={15} />
                <NavigationMenuItemLabel>
                  {calendar.name}
                </NavigationMenuItemLabel>
              </NavigationMenuItemIcon>
              <NavigationMenuItemTrailing />
            </NavigationMenuItem>
          ))
        )}
      </NavigationMenu>
      <NavigationMenu>
        <NavigationMenuItem>
          <Text size="sm" tone="muted" className="shrink-0">Resource Type</Text>
          <div className="min-w-0">
            <Text size="sm" tone="muted" className="truncate">Account</Text>
          </div>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <Text size="sm" tone="muted" className="shrink-0">Calendar Count</Text>
          <div className="min-w-0">
            <Text size="sm" tone="muted" className="truncate">{calendars.length}</Text>
          </div>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <Text size="sm" tone="muted" className="shrink-0">Identifier</Text>
          <div className="min-w-0">
            <Text size="sm" tone="muted" className="truncate">{getAccountLabel(account)}</Text>
          </div>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <Text size="sm" tone="muted" className="shrink-0">Provider</Text>
          <Text size="sm" tone="muted">{account.provider}</Text>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <Text size="sm" tone="muted" className="shrink-0">Authenticated</Text>
          <Text size="sm" tone="muted">{account.authType}</Text>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <Text size="sm" tone="muted" className="shrink-0">Connected</Text>
          <Text size="sm" tone="muted">{new Date(account.createdAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</Text>
        </NavigationMenuItem>
      </NavigationMenu>
      <NavigationMenu>
        <NavigationMenuItem onClick={() => setDeleteOpen(true)}>
          <NavigationMenuItemIcon>
            <Text size="sm" tone="danger">Delete Account</Text>
          </NavigationMenuItemIcon>
        </NavigationMenuItem>
      </NavigationMenu>
      <DeleteConfirmation
        title="Delete calendar account?"
        description="This will remove the account and all its calendars. Any sync profiles using these calendars will be affected."
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        deleting={deleting}
        onConfirm={async () => {
          setDeleting(true);
          try {
            await apiFetch(`/api/accounts/${accountId}`, { method: "DELETE" });
            await invalidateAccountsAndSources(globalMutate, `/api/accounts/${accountId}`);
            navigate({ to: "/dashboard" });
          } finally {
            setDeleting(false);
          }
        }}
      />
    </div>
  );
}
