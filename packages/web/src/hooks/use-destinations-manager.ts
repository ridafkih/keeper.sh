"use client";

import { useCallback, useState } from "react";
import { FREE_DESTINATION_LIMIT } from "@keeper.sh/premium/constants";
import { PROVIDER_DEFINITIONS, isCalDAVProvider, isOAuthProvider, getProvider } from "@keeper.sh/provider-registry";
import type { CalDAVProviderId, ProviderDefinition } from "@keeper.sh/provider-registry";
import { useLinkedAccounts } from "./use-linked-accounts";
import { updateSourceDestinations, useMappings } from "./use-mappings";
import type { SourceDestinationMapping, SourceType } from "./use-mappings";
import { useAllSources } from "./use-all-sources";
import type { UnifiedSource } from "./use-all-sources";
import { useSubscription } from "./use-subscription";
import { useSyncStatus } from "./use-sync-status";
import { track } from "@/lib/analytics";

const getToggleActionLabel = (wasEnabled: boolean): string => {
  if (wasEnabled) {
    return "disabled";
  }
  return "enabled";
};

interface SyncStatusDisplayProps {
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

const isConnectable = (provider: ProviderDefinition): boolean => !provider.comingSoon;

const isCalDAVProviderType = (provider: string): provider is CalDAVProviderId =>
  isCalDAVProvider(provider);

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

const getSourceTypeForMapping = (source: UnifiedSource): SourceType => {
  if (source.type === "ics") {
    return "ics";
  }

  const provider = getProvider(source.type);
  if (provider?.authType === "oauth") {
    return "oauth";
  }

  if (provider?.authType === "caldav") {
    return "caldav";
  }

  return "ics";
};

interface LinkedAccount {
  id: string;
  providerId: string;
  email: string | null;
  needsReauthentication: boolean;
}

interface SyncStatusEntry {
  status: "idle" | "syncing";
  stage?: "fetching" | "comparing" | "processing";
  localEventCount: number;
  remoteEventCount: number;
  progress?: { current: number; total: number };
  lastOperation?: { type: "add" | "remove"; eventTime: string };
  inSync: boolean;
  needsReauthentication?: boolean;
  destinationId: string;
}

type SyncStatusRecord = Record<string, SyncStatusEntry>;

interface DestinationsManagerResult {
  accounts: LinkedAccount[] | undefined;
  caldavDialogOpen: boolean;
  caldavProvider: CalDAVProviderId | null;
  destinationCount: number;
  getProviderConfig: (providerId: string) => ProviderDefinition | undefined;
  getSyncStatus: (destinationId: string) => SyncStatusDisplayProps | null;
  handleCaldavSuccess: () => Promise<void>;
  handleConnect: (providerId: string, destinationId?: string) => void;
  handleDisconnect: (destinationId: string, providerName: string) => Promise<void>;
  handleToggleSource: (destinationId: string, sourceId: string) => Promise<void>;
  isAccountsLoading: boolean;
  isAtLimit: boolean;
  isEmpty: boolean;
  loadingId: string | null;
  mappings: SourceDestinationMapping[];
  setCaldavDialogOpen: (open: boolean) => void;
  sources: UnifiedSource[];
  syncStatus: SyncStatusRecord | undefined;
}

const useDestinationsManager = (
  callbacks: DestinationsManagerCallbacks,
): DestinationsManagerResult => {
  const { onToast, onNavigate } = callbacks;
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [caldavDialogOpen, setCaldavDialogOpen] = useState(false);
  const [caldavProvider, setCaldavProvider] = useState<CalDAVProviderId | null>(null);

  const {
    data: accounts,
    isLoading: isAccountsLoading,
    mutate: mutateAccounts,
  } = useLinkedAccounts();
  const { data: sources } = useAllSources();
  const { data: mappings, mutate: mutateMappings } = useMappings();
  const { data: subscription } = useSubscription();
  const { data: syncStatus } = useSyncStatus();

  const workingAccountsCount =
    accounts?.filter((account) => !account.needsReauthentication).length ?? 0;

  const isAtLimit = subscription?.plan === "free" && workingAccountsCount >= FREE_DESTINATION_LIMIT;

  const destinationCount = accounts?.length ?? 0;
  const isEmpty = !isAccountsLoading && destinationCount === 0;

  const getProviderConfig = useCallback(
    (providerId: string): ProviderDefinition | undefined =>
      PROVIDER_DEFINITIONS.find(
        (provider) => isConnectable(provider) && provider.id === providerId,
      ),
    [],
  );

  const getSyncStatus = useCallback(
    (destinationId: string): SyncStatusDisplayProps | null => {
      const destinationStatus = syncStatus?.[destinationId];
      if (!destinationStatus) {
        return null;
      }
      return {
        inSync: destinationStatus.inSync,
        lastOperation: destinationStatus.lastOperation,
        localCount: destinationStatus.localEventCount,
        progress: destinationStatus.progress,
        remoteCount: destinationStatus.remoteEventCount,
        stage: destinationStatus.stage,
        status: destinationStatus.status,
      };
    },
    [syncStatus],
  );

  const handleConnect = useCallback(
    (providerId: string, destinationId?: string) => {
      if (isCalDAVProviderType(providerId)) {
        setCaldavProvider(providerId);
        setCaldavDialogOpen(true);
        return;
      }

      setLoadingId(destinationId ?? providerId);
      const url = new URL("/api/destinations/authorize", window.location.origin);
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
      if (!mappings || !sources) {
        return;
      }

      const source = sources.find((src) => src.id === sourceId);
      if (!source) {
        return;
      }

      const sourceType = getSourceTypeForMapping(source);
      const currentDestinations = getDestinationsForSource(sourceId, mappings);
      const isEnabled = currentDestinations.includes(destinationId);
      const trackAction = getToggleActionLabel(isEnabled);
      track("mapping_toggled", { action: trackAction });

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
          mapping.sourceId === sourceId && mapping.destinationId === destinationId;

        if (isTargetMapping) {
          continue;
        }

        optimisticData.push(mapping);
      }
      if (!isEnabled) {
        optimisticData.push({
          createdAt: new Date().toISOString(),
          destinationId,
          id: crypto.randomUUID(),
          sourceId,
          sourceType,
        });
      }

      try {
        await mutateMappings(optimisticData, { revalidate: false });
        await updateSourceDestinations(sourceId, newDestinations, sourceType);
      } finally {
        await mutateMappings();
      }
    },
    [mappings, sources, mutateMappings],
  );

  const handleCaldavDialogChange = useCallback((open: boolean): void => {
    setCaldavDialogOpen(open);
  }, []);

  return {
    accounts,
    caldavDialogOpen,
    caldavProvider,
    destinationCount,
    getProviderConfig,
    getSyncStatus,
    handleCaldavSuccess,
    handleConnect,
    handleDisconnect,
    handleToggleSource,
    isAccountsLoading,
    isAtLimit,
    isEmpty,
    loadingId,
    mappings: mappings ?? [],
    setCaldavDialogOpen: handleCaldavDialogChange,
    sources: sources ?? [],
    syncStatus,
  };
};

export { useDestinationsManager };
export type { SyncStatusDisplayProps };
