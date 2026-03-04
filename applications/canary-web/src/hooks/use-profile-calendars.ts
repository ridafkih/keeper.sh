import type { KeyedMutator } from "swr";
import { apiFetch } from "../lib/fetcher";
import type { SyncProfile } from "../types/api";

export function createProfileCalendarActions(
  profileId: string,
  profile: SyncProfile,
  mutateProfile: KeyedMutator<SyncProfile>,
) {
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

  const updateName = async (name: string) => {
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
  };

  return { toggleSource, toggleDestination, updateName };
}
