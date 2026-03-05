import { useState, useTransition } from "react";
import { createFileRoute } from "@tanstack/react-router";
import useSWR from "swr";
import type { KeyedMutator } from "swr";
import { CalendarSync, Check, Plus } from "lucide-react";
import { BackButton } from "../../../../components/ui/back-button";
import { RouteShell } from "../../../../components/ui/route-shell";
import { Text } from "../../../../components/ui/text";
import { apiFetch } from "../../../../lib/fetcher";
import { partitionCalendars } from "../../../../utils/calendars";
import { useProfileCalendarActions, useProfileMutatorFromList } from "../../../../hooks/use-profile-calendars";
import { CalendarCheckboxList } from "../../../../components/dashboard/calendar-checkbox-list";
import type { SyncProfile, CalendarEntry } from "../../../../types/api";
import {
  NavigationMenu,
  NavigationMenuEditableItem,
  NavigationMenuItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuPopover,
  usePopover,
} from "../../../../components/ui/navigation-menu";
import { DeleteConfirmation } from "../../../../components/ui/delete-confirmation";
import { DashboardHeading2 } from "../../../../components/ui/dashboard-heading";

export const Route = createFileRoute("/(dashboard)/dashboard/sync-profiles/")({
  component: SyncProfilesPage,
});

function replaceProfileById(profiles: SyncProfile[], targetId: string, patch: Partial<SyncProfile>): SyncProfile[] {
  return profiles.map((entry) => {
    if (entry.id === targetId) return { ...entry, ...patch };
    return entry;
  });
}

function SyncProfilesPage() {
  const { data: profiles, isLoading, error, mutate: mutateProfiles } = useSWR<SyncProfile[]>(
    "/api/profiles",
  );
  const { data: calendars, error: calendarsError } = useSWR<CalendarEntry[]>("/api/sources");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [autoEdit, setAutoEdit] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();
  const [isCreating, startCreateTransition] = useTransition();

  if (error || calendarsError || isLoading || !profiles) {
    return <RouteShell isLoading={isLoading || !profiles} error={error || calendarsError} onRetry={() => mutateProfiles()}>{null}</RouteShell>;
  }

  const profile = profiles[currentIndex] ?? profiles[0] ?? null;

  const handleCreateProfile = (close: () => void) => {
    startCreateTransition(async () => {
      const response = await apiFetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Profile" }),
      });
      const created: SyncProfile = { name: "New Profile", sources: [], destinations: [], ...await response.json() };
      const updated = [...profiles, created];
      await mutateProfiles(updated, { revalidate: false });
      setCurrentIndex(updated.length - 1);
      setAutoEdit(true);
      close();
    });
  };

  const handleConfirmDelete = () => {
    if (!profile) return;
    const remaining = profiles.filter((entry) => entry.id !== profile.id);

    startDeleteTransition(async () => {
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
    });
  };

  const handleNameCommit = async (name: string) => {
    if (!profile) return;
    const updated = replaceProfileById(profiles, profile.id, { name });
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
      <div className="flex gap-1.5">
        <BackButton />
        <NavigationMenu className="flex-1 min-w-0">
          <NavigationMenuPopover
          trigger={
            <>
              <NavigationMenuItemIcon>
                <CalendarSync size={15} />
              </NavigationMenuItemIcon>
              <NavigationMenuItemLabel>
                {profile ? profile.name : "Select Profile"}
              </NavigationMenuItemLabel>
            </>
          }
        >
          {profiles.map((p, index) => (
            <ProfilePopoverItem
              key={p.id}
              profile={p}
              active={index === currentIndex}
              onSelect={() => setCurrentIndex(index)}
            />
          ))}
          <CreateProfilePopoverItem
            isCreating={isCreating}
            onCreate={handleCreateProfile}
          />
          </NavigationMenuPopover>
        </NavigationMenu>
      </div>
      {profile && (
        <>
          <div className="flex flex-col px-0.5 pt-4">
            <DashboardHeading2>Profile Name</DashboardHeading2>
            <Text size="sm">Click below to rename this sync profile.</Text>
          </div>
          <NavigationMenu className="flex-1 min-w-0">
            <NavigationMenuEditableItem
              key={profile.id}
              value={profile.name}
              autoEdit={autoEdit}
              onCommit={(name) => {
                setAutoEdit(false);
                return handleNameCommit(name);
              }}
            />
          </NavigationMenu>
          <ProfileDetail
            profile={profile}
            profiles={profiles}
            calendars={calendars ?? []}
            mutateProfiles={mutateProfiles}
            onDelete={profiles.length > 1 ? () => setDeleteOpen(true) : undefined}
          />
          <DeleteConfirmation
            title="Delete sync profile?"
            description="This will remove the profile and all its sync mappings. Your calendars will not be deleted."
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            deleting={isDeleting}
            onConfirm={handleConfirmDelete}
          />
        </>
      )}
    </div>
  );
}

interface ProfilePopoverItemProps {
  profile: SyncProfile;
  active: boolean;
  onSelect: () => void;
}

function ProfilePopoverItem({ profile, active, onSelect }: ProfilePopoverItemProps) {
  const { close } = usePopover();

  return (
    <NavigationMenuItem
      onClick={() => {
        onSelect();
        close();
      }}
    >
      <NavigationMenuItemIcon>
        <CalendarSync size={15} />
      </NavigationMenuItemIcon>
      <NavigationMenuItemLabel className={active ? "font-medium" : ""}>
        {profile.name}
      </NavigationMenuItemLabel>
      {active && <Check size={15} className="ml-auto shrink-0 text-foreground-muted" />}
    </NavigationMenuItem>
  );
}

interface CreateProfilePopoverItemProps {
  isCreating: boolean;
  onCreate: (close: () => void) => void;
}

function CreateProfilePopoverItem({ isCreating, onCreate }: CreateProfilePopoverItemProps) {
  const { close } = usePopover();

  return (
    <NavigationMenuItem onClick={() => onCreate(close)}>
      <NavigationMenuItemIcon>
        <Plus size={15} />
      </NavigationMenuItemIcon>
      <NavigationMenuItemLabel>
        {isCreating ? "Creating..." : "New Profile"}
      </NavigationMenuItemLabel>
    </NavigationMenuItem>
  );
}

interface ProfileDetailProps {
  profile: SyncProfile;
  profiles: SyncProfile[];
  calendars: CalendarEntry[];
  mutateProfiles: KeyedMutator<SyncProfile[]>;
  onDelete?: () => void;
}

function ProfileDetail({ profile, profiles, calendars, mutateProfiles, onDelete }: ProfileDetailProps) {
  const { pull: pullCalendars, push: pushCalendars } = partitionCalendars(calendars);

  const sourceSet = new Set(profile.sources);
  const destinationSet = new Set(profile.destinations);

  const mutateProfile = useProfileMutatorFromList(profile, profiles, mutateProfiles);
  const { toggleSource, toggleDestination } = useProfileCalendarActions(profile.id, profile, mutateProfile);

  return (
    <>
      <div className="flex flex-col px-0.5 pt-4">
        <DashboardHeading2>Event Sources</DashboardHeading2>
        <Text size="sm">Events from the marked calendars will be pooled, and pushed to the calendars marked as destinations below.</Text>
      </div>
      <CalendarCheckboxList
        calendars={pullCalendars}
        selectedIds={sourceSet}
        onToggle={toggleSource}
        emptyLabel="No source calendars"
      />
      <div className="flex flex-col px-0.5 pt-4">
        <DashboardHeading2>Event Destinations</DashboardHeading2>
        <Text size="sm">When you mark a calendar below, events from the sources will be pushed to that calendar.</Text>
      </div>
      <CalendarCheckboxList
        calendars={pushCalendars}
        selectedIds={destinationSet}
        onToggle={toggleDestination}
        emptyLabel="No destination calendars"
      />
      {onDelete && (
        <NavigationMenu>
          <NavigationMenuItem onClick={onDelete}>
            <Text size="sm" tone="danger">Delete Profile</Text>
          </NavigationMenuItem>
        </NavigationMenu>
      )}
    </>
  );
}
