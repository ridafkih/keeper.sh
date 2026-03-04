import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import useSWR, { useSWRConfig } from "swr";
import { LoaderCircle, ArrowDown } from "lucide-react";
import { ErrorState } from "../../../../components/ui/error-state";
import { BackButton } from "../../../../components/ui/back-button";
import { Button, ButtonText } from "../../../../components/ui/button";
import { ProviderIcon } from "../../../../components/ui/provider-icon";
import { Text } from "../../../../components/ui/text";
import { apiFetch } from "../../../../lib/fetcher";
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
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalTitle,
} from "../../../../components/ui/modal";

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

  if (error || calendarsError) {
    return (
      <div className="flex flex-col gap-1.5">
        <BackButton fallback="/dashboard/calendars" />
        <ErrorState onRetry={() => mutateProfile()} />
      </div>
    );
  }

  if (isLoading || !profile) {
    return (
      <div className="flex flex-col gap-1.5">
        <BackButton fallback="/dashboard/calendars" />
        <div className="flex justify-center py-6">
          <LoaderCircle size={20} className="animate-spin text-foreground-muted" />
        </div>
      </div>
    );
  }

  const pullCalendars = (calendars ?? []).filter((calendar) => calendar.capabilities.includes("pull"));
  const pushCalendars = (calendars ?? []).filter((calendar) => calendar.capabilities.includes("push"));

  const sourceSet = new Set(profile.sources);
  const destinationSet = new Set(profile.destinations);

  const toggleSource = async (calendarId: string, checked: boolean) => {
    const updatedSources = checked
      ? [...profile.sources, calendarId]
      : profile.sources.filter((id) => id !== calendarId);

    await mutateProfile(
      async (current) => {
        await apiFetch(`/api/profiles/${profileId}/sources`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ calendarIds: updatedSources }),
        });
        return current ? { ...current, sources: updatedSources } : current;
      },
      {
        optimisticData: { ...profile, sources: updatedSources },
        rollbackOnError: true,
        revalidate: false,
      },
    );
  };

  const toggleDestination = async (calendarId: string, checked: boolean) => {
    const updatedDestinations = checked
      ? [...profile.destinations, calendarId]
      : profile.destinations.filter((id) => id !== calendarId);

    await mutateProfile(
      async (current) => {
        await apiFetch(`/api/profiles/${profileId}/destinations`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ calendarIds: updatedDestinations }),
        });
        return current ? { ...current, destinations: updatedDestinations } : current;
      },
      {
        optimisticData: { ...profile, destinations: updatedDestinations },
        rollbackOnError: true,
        revalidate: false,
      },
    );
  };

  return (
    <div className="flex flex-col gap-1.5">
      <BackButton fallback="/dashboard/calendars" />
      <NavigationMenu>
        <NavigationMenuEditableItem
          value={profile.name}
          onCommit={async (name) => {
            await mutateProfile(
              async (current) => {
                await apiFetch(`/api/profiles/${profileId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name }),
                });
                return current ? { ...current, name } : current;
              },
              {
                optimisticData: { ...profile, name },
                rollbackOnError: true,
                revalidate: false,
              },
            );
          }}
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
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        deleting={deleting}
        onConfirm={async () => {
          setDeleting(true);
          try {
            await apiFetch(`/api/profiles/${profileId}`, { method: "DELETE" });
            await Promise.all([
              globalMutate("/api/profiles"),
              globalMutate(`/api/profiles/${profileId}`),
            ]);
            navigate({ to: "/dashboard/calendars" });
          } finally {
            setDeleting(false);
          }
        }}
      />
    </div>
  );
}

interface DeleteConfirmationProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deleting: boolean;
  onConfirm: () => void;
}

function DeleteConfirmation({ open, onOpenChange, deleting, onConfirm }: DeleteConfirmationProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalTitle>Delete sync profile?</ModalTitle>
        <ModalDescription>
          This will remove the profile and all its sync mappings. Your calendars will not be deleted.
        </ModalDescription>
        <ModalFooter>
          <Button variant="destructive" className="w-full justify-center" onClick={onConfirm} disabled={deleting}>
            {deleting && <LoaderCircle size={16} className="animate-spin" />}
            <ButtonText>{deleting ? "Deleting..." : "Delete"}</ButtonText>
          </Button>
          <Button variant="elevated" className="w-full justify-center" onClick={() => onOpenChange(false)}>
            <ButtonText>Cancel</ButtonText>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
