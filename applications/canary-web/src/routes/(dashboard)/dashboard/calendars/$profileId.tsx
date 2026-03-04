import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import useSWR, { useSWRConfig } from "swr";
import { ArrowDown } from "lucide-react";
import { BackButton } from "../../../../components/ui/back-button";
import { RouteShell } from "../../../../components/ui/route-shell";
import { Button, ButtonText } from "../../../../components/ui/button";
import { ProviderIcon } from "../../../../components/ui/provider-icon";
import { Text } from "../../../../components/ui/text";
import { apiFetch } from "../../../../lib/fetcher";
import { invalidateAccountsAndSources } from "../../../../lib/swr";
import { createProfileCalendarActions } from "../../../../hooks/use-profile-calendars";
import type { SyncProfile, CalendarEntry } from "../../../../types/api";
import {
  NavigationMenu,
  NavigationMenuCheckboxItem,
  NavigationMenuEditableItem,
  NavigationMenuEmptyItem,
  NavigationMenuItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
} from "../../../../components/ui/navigation-menu";
import { DeleteConfirmation } from "../../../../components/ui/delete-confirmation";

export const Route = createFileRoute(
  "/(dashboard)/dashboard/calendars/$profileId",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { profileId } = Route.useParams();
  const navigate = useNavigate();
  const { mutate: globalMutate } = useSWRConfig();
  const { data: profile, isLoading, error, mutate: mutateProfile } = useSWR<SyncProfile>(
    `/api/profiles/${profileId}`,
  );
  const { data: calendars, error: calendarsError } = useSWR<CalendarEntry[]>("/api/sources");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (error || calendarsError || isLoading || !profile) {
    return <RouteShell backFallback="/dashboard/calendars" isLoading={isLoading || !profile} error={error || calendarsError} onRetry={() => mutateProfile()}>{null}</RouteShell>;
  }

  const { toggleSource, toggleDestination, updateName } = createProfileCalendarActions(profileId, profile, mutateProfile);

  const pullCalendars = (calendars ?? []).filter((calendar) => calendar.capabilities.includes("pull"));
  const pushCalendars = (calendars ?? []).filter((calendar) => calendar.capabilities.includes("push"));

  const sourceSet = new Set(profile.sources);
  const destinationSet = new Set(profile.destinations);

  return (
    <div className="flex flex-col gap-1.5">
      <BackButton fallback="/dashboard/calendars" />
      <NavigationMenu>
        <NavigationMenuEditableItem
          value={profile.name}
          onCommit={updateName}
        />
      </NavigationMenu>
      <NavigationMenu>
        {pullCalendars.length === 0 ? (
          <NavigationMenuEmptyItem>No source calendars</NavigationMenuEmptyItem>
        ) : (
          pullCalendars.map((calendar) => (
            <NavigationMenuCheckboxItem
              key={calendar.id}
              checked={sourceSet.has(calendar.id)}
              onCheckedChange={(checked) => toggleSource(calendar.id, checked)}
            >
              <NavigationMenuItemIcon>
                <ProviderIcon provider={calendar.provider ?? calendar.calendarType} calendarType={calendar.calendarType} />
                <NavigationMenuItemLabel>{calendar.name}</NavigationMenuItemLabel>
              </NavigationMenuItemIcon>
            </NavigationMenuCheckboxItem>
          ))
        )}
      </NavigationMenu>
      <div className="self-center py-2">
        <ArrowDown size={16} className="text-foreground-muted" />
      </div>
      <NavigationMenu>
        {pushCalendars.length === 0 ? (
          <NavigationMenuEmptyItem>No destination calendars</NavigationMenuEmptyItem>
        ) : (
          pushCalendars.map((calendar) => (
            <NavigationMenuCheckboxItem
              key={calendar.id}
              checked={destinationSet.has(calendar.id)}
              onCheckedChange={(checked) => toggleDestination(calendar.id, checked)}
            >
              <NavigationMenuItemIcon>
                <ProviderIcon provider={calendar.provider ?? calendar.calendarType} calendarType={calendar.calendarType} />
                <NavigationMenuItemLabel>{calendar.name}</NavigationMenuItemLabel>
              </NavigationMenuItemIcon>
            </NavigationMenuCheckboxItem>
          ))
        )}
      </NavigationMenu>
      <NavigationMenu>
        <NavigationMenuItem onClick={() => setDeleteOpen(true)}>
          <NavigationMenuItemIcon>
            <Text size="sm" tone="danger">Delete Profile</Text>
          </NavigationMenuItemIcon>
        </NavigationMenuItem>
      </NavigationMenu>
      <DeleteConfirmation
        title="Delete sync profile?"
        description="This will remove the profile and all its sync mappings. Your calendars will not be deleted."
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        deleting={deleting}
        onConfirm={async () => {
          setDeleting(true);
          try {
            await apiFetch(`/api/profiles/${profileId}`, { method: "DELETE" });
            await invalidateAccountsAndSources(globalMutate, "/api/profiles", `/api/profiles/${profileId}`);
            navigate({ to: "/dashboard/calendars" });
          } finally {
            setDeleting(false);
          }
        }}
      />
    </div>
  );
}

