"use client";

import { useState, useCallback } from "react";
import { FREE_DESTINATION_LIMIT } from "@keeper.sh/premium/constants";
import {
  DESTINATIONS,
  isCalDAVDestination,
  type DestinationConfig,
  type CalDAVDestinationId,
} from "@keeper.sh/destination-metadata";
import { useLinkedAccounts } from "./use-linked-accounts";
import {
  useMappings,
  updateSourceDestinations,
  type SourceDestinationMapping,
} from "./use-mappings";
import { useSources, type CalendarSource } from "./use-sources";
import { useSubscription } from "./use-subscription";
import { useSyncStatus } from "./use-sync-status";
import { track } from "@/lib/analytics";

export interface SyncStatusDisplayProps {
  status: "idle" | "syncing";
  stage?: "fetching" | "comparing" | "processing";
  localCount: number;
  remoteCount: number;
  progress?: { current: number; total: number };
  lastOperation?: { type: "add" | "remove"; eventTime: string };
  inSync: boolean;
}

interface DestinationsManagerCallbacks {
  onToast: (message: string) => void;
  onNavigate: (url: string) => void;
}

const isConnectable = (destination: DestinationConfig): boolean =>
  !destination.comingSoon;

const isCalDAVProvider = (provider: string): provider is CalDAVDestinationId =>
  isCalDAVDestination(provider);

const getDestinationsForSource = (
  sourceId: string,
  mappings: SourceDestinationMapping[],
): string[] => {
  const destinationIds: string[] = [];
  for (const mapping of mappings) {
    if (mapping.sourceId === sourceId) {
      destinationIds.push(mapping.destinationId);
    }
  }
  return destinationIds;
};

export const useDestinationsManager = (
  callbacks: DestinationsManagerCallbacks,
) => {
  const { onToast, onNavigate } = callbacks;
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [caldavDialogOpen, setCaldavDialogOpen] = useState(false);
  const [caldavProvider, setCaldavProvider] =
    useState<CalDAVDestinationId | null>(null);

  const {
    data: accounts,
    isLoading: isAccountsLoading,
    mutate: mutateAccounts,
  } = useLinkedAccounts();
  const { data: sources } = useSources();
  const { data: mappings, mutate: mutateMappings } = useMappings();
  const { data: subscription } = useSubscription();
  const { data: syncStatus } = useSyncStatus();

  const workingAccountsCount =
    accounts?.filter((account) => !account.needsReauthentication).length ?? 0;

  const isAtLimit =
    subscription?.plan === "free" &&
    workingAccountsCount >= FREE_DESTINATION_LIMIT;

  const destinationCount = accounts?.length ?? 0;
  const isEmpty = !isAccountsLoading && destinationCount === 0;

  const getDestinationConfig = useCallback(
    (providerId: string): DestinationConfig | undefined => {
      return DESTINATIONS.find(
        (destination) =>
          isConnectable(destination) && destination.id === providerId,
      );
    },
    [],
  );

  const getSyncStatus = useCallback(
    (destinationId: string): SyncStatusDisplayProps | undefined => {
      const destinationStatus = syncStatus?.[destinationId];
      if (!destinationStatus) return undefined;
      return {
        status: destinationStatus.status,
        stage: destinationStatus.stage,
        localCount: destinationStatus.localEventCount,
        remoteCount: destinationStatus.remoteEventCount,
        progress: destinationStatus.progress,
        lastOperation: destinationStatus.lastOperation,
        inSync: destinationStatus.inSync,
      };
    },
    [syncStatus],
  );

  const handleConnect = useCallback(
    (providerId: string, destinationId?: string) => {
      if (isCalDAVProvider(providerId)) {
        setCaldavProvider(providerId);
        setCaldavDialogOpen(true);
        return;
      }

      setLoadingId(destinationId ?? providerId);
      const url = new URL(
        "/api/destinations/authorize",
        window.location.origin,
      );
      url.searchParams.set("provider", providerId);

      if (destinationId) {
        url.searchParams.set("destinationId", destinationId);
      }

      onNavigate(url.toString());
    },
    [onNavigate],
  );

  const handleCaldavSuccess = useCallback(async () => {
    await mutateAccounts();
    track("destination_connected", { provider: caldavProvider ?? "caldav" });
    onToast("Calendar connected successfully");
  }, [mutateAccounts, caldavProvider, onToast]);

  const handleDisconnect = useCallback(
    async (destinationId: string, providerName: string) => {
      setLoadingId(destinationId);
      try {
        const response = await fetch(`/api/destinations/${destinationId}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          throw new Error("Failed to disconnect");
        }

        await mutateAccounts();
        track("destination_disconnected", { provider: providerName });
        onToast(`Disconnected from ${providerName}`);
      } catch {
        onToast("Failed to disconnect");
      } finally {
        setLoadingId(null);
      }
    },
    [mutateAccounts, onToast],
  );

  const handleToggleSource = useCallback(
    async (destinationId: string, sourceId: string) => {
      if (!mappings) return;

      const currentDestinations = getDestinationsForSource(sourceId, mappings);
      const isEnabled = currentDestinations.includes(destinationId);
      track("mapping_toggled", { action: isEnabled ? "disabled" : "enabled" });

      const newDestinations: string[] = [];
      for (const destId of currentDestinations) {
        if (destId !== destinationId) {
          newDestinations.push(destId);
        }
      }
      if (!isEnabled) {
        newDestinations.push(destinationId);
      }

      const optimisticData: SourceDestinationMapping[] = [];
      for (const mapping of mappings) {
        const isTargetMapping =
          mapping.sourceId === sourceId &&
          mapping.destinationId === destinationId;

        if (isTargetMapping) continue;

        optimisticData.push(mapping);
      }
      if (!isEnabled) {
        optimisticData.push({
          id: crypto.randomUUID(),
          sourceId,
          destinationId,
          createdAt: new Date().toISOString(),
        });
      }

      try {
        await mutateMappings(optimisticData, { revalidate: false });
        await updateSourceDestinations(sourceId, newDestinations);
      } finally {
        await mutateMappings();
      }
    },
    [mappings, mutateMappings],
  );

  const handleCaldavDialogChange = useCallback((open: boolean) => {
    setCaldavDialogOpen(open);
  }, []);

  return {
    accounts,
    sources: sources ?? [],
    mappings: mappings ?? [],
    syncStatus,
    isAccountsLoading,
    loadingId,
    caldavDialogOpen,
    caldavProvider,
    isAtLimit,
    destinationCount,
    isEmpty,
    handleConnect,
    handleDisconnect,
    handleToggleSource,
    handleCaldavSuccess,
    setCaldavDialogOpen: handleCaldavDialogChange,
    getDestinationConfig,
    getSyncStatus,
  };
};
