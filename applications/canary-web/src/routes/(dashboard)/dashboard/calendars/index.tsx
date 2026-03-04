import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import useSWR from "swr";
import { ArrowDown, ChevronLeft, ChevronRight } from "lucide-react";
import { BackButton } from "../../../../components/ui/back-button";
import { RouteShell } from "../../../../components/ui/route-shell";
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
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItem,
} from "../../../../components/ui/navigation-menu";
import { DeleteConfirmation } from "../../../../components/ui/delete-confirmation";

export const Route = createFileRoute("/(dashboard)/dashboard/calendars/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { data: profiles, isLoading, error, mutate: mutateProfiles } = useSWR<SyncProfile[]>(
    "/api/profiles",
  );
  const { data: calendars, error: calendarsError } = useSWR<CalendarEntry[]>("/api/sources");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [newProfileName, setNewProfileName] = useState("New Profile");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (error || calendarsError || isLoading || !profiles) {
    return <RouteShell isLoading={isLoading || !profiles} error={error || calendarsError} onRetry={() => mutateProfiles()}>{null}</RouteShell>;
  }

  const isNewSlot = currentIndex >= profiles.length;
  const profile = isNewSlot ? null : profiles[currentIndex];
  const totalSlots = profiles.length + 1;

  const canGoLeft = currentIndex > 0;
  const canGoRight = currentIndex < totalSlots - 1;

  const profileName = isNewSlot ? newProfileName : profile?.name ?? "";

  const handleNameCommit = async (name: string) => {
    if (isNewSlot) {
      setNewProfileName(name);
      const response = await apiFetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const created = await response.json();
      await mutateProfiles(
        [...(profiles ?? []), created],
        { revalidate: false },
      );
      setNewProfileName("New Profile");
      return;
    }
    if (!profile) return;
    const updated = profiles.map((p) => (p.id === profile.id ? { ...p, name } : p));
    await mutateProfiles(
      async () => {
        await apiFetch(`/api/profiles/${profile.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        return updated;
      },
      {
        optimisticData: updated,
        rollbackOnError: true,
        revalidate: false,
      },
    );
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between">
        <BackButton />
        <div className="flex justify-end gap-1">
          <Button
            variant="elevated"
            size="compact"
            className="aspect-square"
            onClick={() => setCurrentIndex(currentIndex - 1)}
            disabled={!canGoLeft}
          >
            <ChevronLeft size={16} />
          </Button>
          <Button
            variant="elevated"
            size="compact"
            className="aspect-square"
            onClick={() => setCurrentIndex(currentIndex + 1)}
            disabled={!canGoRight}
          >
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>
      <NavigationMenu className="flex-1 min-w-0">
        <NavigationMenuEditableItem
          key={isNewSlot ? "__new__" : profile?.id}
          value={profileName}
          onCommit={handleNameCommit}
        />
      </NavigationMenu>
      {isNewSlot ? (
        <NewProfileSlot
          name={newProfileName}
          calendars={calendars ?? []}
          onProfileCreated={() => mutateProfiles()}
        />
      ) : profile ? (
        <ProfileDetail
          profile={profile}
          profiles={profiles}
          calendars={calendars ?? []}
          mutateProfiles={mutateProfiles}
          onDelete={profiles.length > 1 ? () => setDeleteOpen(true) : undefined}
        />
      ) : null}
      {profile && (
        <DeleteConfirmation
          title="Delete sync profile?"
          description="This will remove the profile and all its sync mappings. Your calendars will not be deleted."
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          deleting={deleting}
          onConfirm={async () => {
            setDeleting(true);
            const remaining = profiles.filter((p) => p.id !== profile.id);
            try {
              await mutateProfiles(
                async () => {
                  await apiFetch(`/api/profiles/${profile.id}`, { method: "DELETE" });
                  return remaining;
                },
                {
                  optimisticData: remaining,
                  rollbackOnError: true,
                  revalidate: false,
                },
              );
              const newLength = remaining.length;
              if (currentIndex >= newLength) {
                setCurrentIndex(Math.max(0, newLength - 1));
              }
              setDeleteOpen(false);
            } finally {
              setDeleting(false);
            }
          }}
        />
      )}
    </div>
  );
}

interface NewProfileSlotProps {
  name: string;
  calendars: CalendarEntry[];
  onProfileCreated: () => void;
}

function NewProfileSlot({ name, calendars, onProfileCreated }: NewProfileSlotProps) {
  const [sources, setSources] = useState<Set<string>>(new Set());
  const [destinations, setDestinations] = useState<Set<string>>(new Set());
  const profileIdRef = useRef<string | null>(null);
  const creatingRef = useRef<Promise<string> | null>(null);
  const nameRef = useRef(name);
  nameRef.current = name;

  const pullCalendars = calendars.filter((calendar) => calendar.capabilities.includes("pull"));
  const pushCalendars = calendars.filter((calendar) => calendar.capabilities.includes("push"));

  const ensureProfile = async (): Promise<string> => {
    if (profileIdRef.current) return profileIdRef.current;
    if (creatingRef.current) return creatingRef.current;

    creatingRef.current = apiFetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nameRef.current }),
    })
      .then((response) => response.json())
      .then(({ id }) => {
        profileIdRef.current = id;
        return id as string;
      });

    return creatingRef.current;
  };

  const toggleSource = async (calendarId: string, checked: boolean) => {
    const next = new Set(sources);
    if (checked) {
      next.add(calendarId);
    } else {
      next.delete(calendarId);
    }
    setSources(next);

    const profileId = await ensureProfile();
    await apiFetch(`/api/profiles/${profileId}/sources`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ calendarIds: [...next] }),
    });
    onProfileCreated();
  };

  const toggleDestination = async (calendarId: string, checked: boolean) => {
    const next = new Set(destinations);
    if (checked) {
      next.add(calendarId);
    } else {
      next.delete(calendarId);
    }
    setDestinations(next);

    const profileId = await ensureProfile();
    await apiFetch(`/api/profiles/${profileId}/destinations`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ calendarIds: [...next] }),
    });
    onProfileCreated();
  };

  return (
    <>
      <NavigationMenu>
        {pullCalendars.length === 0 ? (
          <NavigationMenuEmptyItem>No source calendars</NavigationMenuEmptyItem>
        ) : (
          pullCalendars.map((calendar) => (
            <NavigationMenuCheckboxItem
              key={calendar.id}
              checked={sources.has(calendar.id)}
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
              checked={destinations.has(calendar.id)}
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
    </>
  );
}

interface ProfileDetailProps {
  profile: SyncProfile;
  profiles: SyncProfile[];
  calendars: CalendarEntry[];
  mutateProfiles: (
    data?: SyncProfile[] | Promise<SyncProfile[] | undefined> | ((current?: SyncProfile[]) => Promise<SyncProfile[] | undefined>),
    opts?: { optimisticData?: SyncProfile[]; rollbackOnError?: boolean; revalidate?: boolean },
  ) => Promise<SyncProfile[] | undefined>;
  onDelete?: () => void;
}

function ProfileDetail({ profile, profiles, calendars, mutateProfiles, onDelete }: ProfileDetailProps) {
  const pullCalendars = calendars.filter((calendar) => calendar.capabilities.includes("pull"));
  const pushCalendars = calendars.filter((calendar) => calendar.capabilities.includes("push"));

  const sourceSet = new Set(profile.sources);
  const destinationSet = new Set(profile.destinations);

  const replaceProfile = (updated: SyncProfile) =>
    profiles.map((p) => (p.id === profile.id ? updated : p));

  const updateProfile = async (
    updatedProfile: SyncProfile,
    apiCall: () => Promise<void>,
  ) => {
    const updated = replaceProfile(updatedProfile);
    await mutateProfiles(
      async () => {
        await apiCall();
        return updated;
      },
      {
        optimisticData: updated,
        rollbackOnError: true,
        revalidate: false,
      },
    );
  };

  const toggleSource = async (calendarId: string, checked: boolean) => {
    const updatedSources = checked
      ? [...profile.sources, calendarId]
      : profile.sources.filter((id) => id !== calendarId);

    await updateProfile(
      { ...profile, sources: updatedSources },
      () => apiFetch(`/api/profiles/${profile.id}/sources`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendarIds: updatedSources }),
      }).then(() => {}),
    );
  };

  const toggleDestination = async (calendarId: string, checked: boolean) => {
    const updatedDestinations = checked
      ? [...profile.destinations, calendarId]
      : profile.destinations.filter((id) => id !== calendarId);

    await updateProfile(
      { ...profile, destinations: updatedDestinations },
      () => apiFetch(`/api/profiles/${profile.id}/destinations`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendarIds: updatedDestinations }),
      }).then(() => {}),
    );
  };

  return (
    <>
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
      {onDelete && (
        <NavigationMenu>
          <NavigationMenuItem onClick={onDelete}>
            <NavigationMenuItemIcon>
              <Text size="sm" tone="danger">Delete Profile</Text>
            </NavigationMenuItemIcon>
          </NavigationMenuItem>
        </NavigationMenu>
      )}
    </>
  );
}

