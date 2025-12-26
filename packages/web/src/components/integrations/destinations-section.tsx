"use client";

import { useState } from "react";
import Image from "next/image";
import { Button } from "@base-ui/react/button";
import { Menu } from "@base-ui/react/menu";
import { Card } from "@/components/card";
import { EmptyState } from "@/components/empty-state";
import { GhostButton } from "@/components/ghost-button";
import { ListSkeleton } from "@/components/list-skeleton";
import { MenuItem } from "@/components/menu-item";
import { MenuPopup } from "@/components/menu-popup";
import { Toast } from "@/components/toast-provider";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { IconBox } from "@/components/icon-box";
import { Section } from "@/components/section";
import { SectionHeader } from "@/components/section-header";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useLinkedAccounts } from "@/hooks/use-linked-accounts";
import { useSyncStatus } from "@/hooks/use-sync-status";
import { TextLabel, TextMeta, TextMuted } from "@/components/typography";
import { button } from "@/styles";
import { Server, Plus } from "lucide-react";

type SupportedProvider = "google";

interface BaseDestination {
  id: string;
  name: string;
  icon?: string;
  pushesEvents?: boolean;
}

interface ConnectableDestination extends BaseDestination {
  providerId: SupportedProvider;
  comingSoon?: false;
}

interface ComingSoonDestination extends BaseDestination {
  providerId?: never;
  comingSoon: true;
}

type Destination = ConnectableDestination | ComingSoonDestination;

const DESTINATIONS: Destination[] = [
  {
    id: "google",
    providerId: "google",
    name: "Google Calendar",
    icon: "/integrations/icon-google.svg",
    pushesEvents: true,
  },
  {
    id: "outlook",
    name: "Outlook",
    icon: "/integrations/icon-outlook.svg",
    comingSoon: true,
    pushesEvents: true,
  },
  {
    id: "caldav",
    name: "CalDAV",
    comingSoon: true,
    pushesEvents: true,
  },
];

interface DestinationActionProps {
  comingSoon?: boolean;
  isConnected: boolean;
  isLoading: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

const DestinationAction = ({
  comingSoon,
  isConnected,
  isLoading,
  onConnect,
  onDisconnect,
}: DestinationActionProps) => {
  if (comingSoon) {
    return (
      <TextMuted className="ml-auto px-2 py-1 text-xs">Coming soon</TextMuted>
    );
  }

  if (isConnected) {
    return (
      <Menu.Root>
        <GhostButton
          render={<Menu.Trigger />}
          disabled={isLoading}
          className="flex items-center gap-1.5"
        >
          {!isLoading && <span className="size-1.5 rounded-full bg-success" />}
          {isLoading ? "..." : "Connected"}
        </GhostButton>
        <Menu.Portal>
          <Menu.Positioner sideOffset={4} align="end">
            <MenuPopup minWidth="md">
              <MenuItem onClick={onConnect}>Reauthenticate</MenuItem>
              <MenuItem variant="danger" onClick={onDisconnect}>
                Disconnect
              </MenuItem>
            </MenuPopup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    );
  }

  return (
    <GhostButton onClick={onConnect} disabled={isLoading} className="ml-auto">
      {isLoading ? "..." : "Connect"}
    </GhostButton>
  );
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

const STAGE_LABELS: Record<string, string> = {
  fetching: "Fetching",
  comparing: "Comparing",
  processing: "Processing",
};

interface SyncStatusTextProps {
  syncStatus: SyncStatusDisplayProps;
}

const SyncStatusText = ({ syncStatus }: SyncStatusTextProps) => {
  const isSyncing = syncStatus.status === "syncing" && syncStatus.stage;

  if (!isSyncing) {
    if (syncStatus.inSync) {
      return <TextMeta>{syncStatus.remoteCount} events synced</TextMeta>;
    }
    return (
      <TextMeta>
        {syncStatus.remoteCount}/{syncStatus.localCount} events
      </TextMeta>
    );
  }

  const stageLabel = STAGE_LABELS[syncStatus.stage!] ?? "Syncing";
  const { progress } = syncStatus;
  const hasProgress = progress && progress.total > 0;

  if (hasProgress) {
    return (
      <TextMeta>
        {stageLabel} (
        <span className="tabular-nums">
          {progress.current}/{progress.total}
        </span>
        )
      </TextMeta>
    );
  }

  return <TextMeta>{stageLabel}...</TextMeta>;
};

interface DestinationItemProps {
  destination: Destination;
  syncStatus?: SyncStatusDisplayProps;
  isConnected: boolean;
  isLoading: boolean;
  onConnect: () => void;
  onDisconnect: () => Promise<void>;
}

const DestinationItem = ({
  destination,
  isConnected,
  isLoading,
  onConnect,
  onDisconnect,
  syncStatus,
}: DestinationItemProps) => {
  const { isOpen, isConfirming, open, setIsOpen, confirm } = useConfirmAction();

  return (
    <>
      <div>
        <div className="flex items-center gap-2 px-3 py-2">
          <IconBox>
            {destination.icon ? (
              <Image
                src={destination.icon}
                alt={destination.name}
                width={14}
                height={14}
              />
            ) : (
              <Server size={14} className="text-foreground-subtle" />
            )}
          </IconBox>
          <div className="flex-1 min-w-0 flex flex-col">
            <TextLabel as="h2" className="tracking-tight">
              {destination.name}
            </TextLabel>
            {isConnected && syncStatus && (
              <SyncStatusText syncStatus={syncStatus} />
            )}
          </div>
          <DestinationAction
            comingSoon={destination.comingSoon}
            isConnected={isConnected}
            isLoading={isLoading}
            onConnect={onConnect}
            onDisconnect={open}
          />
        </div>
      </div>
      <ConfirmDialog
        open={isOpen}
        onOpenChange={setIsOpen}
        title={`Disconnect ${destination.name}`}
        description={
          destination.pushesEvents
            ? `Synced events will remain on ${destination.name}. Remove sources first to clear them.`
            : `Events will no longer sync to ${destination.name}.`
        }
        confirmLabel="Disconnect"
        isConfirming={isConfirming}
        onConfirm={() => confirm(onDisconnect)}
        requirePhrase={destination.pushesEvents ? "I understand" : undefined}
      />
    </>
  );
};

const isConnectable = (
  destination: Destination,
): destination is ConnectableDestination => !destination.comingSoon;

export const DestinationsSection = () => {
  const toastManager = Toast.useToastManager();
  const [loadingProvider, setLoadingProvider] =
    useState<SupportedProvider | null>(null);
  const {
    data: accounts,
    isLoading: isAccountsLoading,
    mutate: mutateAccounts,
  } = useLinkedAccounts();
  const { data: syncStatus } = useSyncStatus();

  const isProviderConnected = (providerId: SupportedProvider) =>
    accounts?.some((account) => account.providerId === providerId) ?? false;

  const connectedDestinations = DESTINATIONS.filter(isConnectable).filter(
    (destination) => isProviderConnected(destination.providerId),
  );

  const getSyncStatus = (
    providerId: SupportedProvider,
  ): SyncStatusDisplayProps | undefined => {
    const providerStatus = syncStatus?.[providerId];
    if (!providerStatus) return undefined;
    return {
      status: providerStatus.status,
      stage: providerStatus.stage,
      localCount: providerStatus.localEventCount,
      remoteCount: providerStatus.remoteEventCount,
      progress: providerStatus.progress,
      lastOperation: providerStatus.lastOperation,
      inSync: providerStatus.inSync,
    };
  };

  const handleConnect = (providerId: SupportedProvider) => {
    setLoadingProvider(providerId);
    const url = new URL("/api/destinations/authorize", window.location.origin);
    url.searchParams.set("provider", providerId);
    window.location.href = url.toString();
  };

  const handleDisconnect = async (providerId: SupportedProvider) => {
    setLoadingProvider(providerId);
    try {
      const response = await fetch(`/api/destinations/${providerId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to disconnect");
      }

      await mutateAccounts();
      toastManager.add({ title: `Disconnected from ${providerId}` });
    } catch {
      toastManager.add({ title: `Failed to disconnect` });
    } finally {
      setLoadingProvider(null);
    }
  };

  const destinationCount = connectedDestinations.length;
  const isEmpty = !isAccountsLoading && destinationCount === 0;

  const destinationsMenuItems = DESTINATIONS.map((destination) => {
    const connectable = isConnectable(destination);
    return (
      <MenuItem
        key={destination.id}
        onClick={() => connectable && handleConnect(destination.providerId)}
        disabled={destination.comingSoon}
        variant={destination.comingSoon ? "disabled" : "default"}
        className="py-1.5"
      >
        {destination.icon ? (
          <Image
            src={destination.icon}
            alt={destination.name}
            width={14}
            height={14}
            className={destination.comingSoon ? "opacity-50" : ""}
          />
        ) : (
          <Server size={14} className="text-foreground-subtle" />
        )}
        <span>{destination.name}</span>
        {destination.comingSoon && (
          <span className="ml-4 text-xs">Unavailable</span>
        )}
      </MenuItem>
    );
  });

  const renderContent = () => {
    if (isAccountsLoading) {
      return <ListSkeleton rows={1} />;
    }

    if (isEmpty) {
      return (
        <EmptyState
          icon={<Server size={16} className="text-foreground-subtle" />}
          message="No destinations connected yet. Connect a calendar to push your aggregated events."
          action={
            <Menu.Root>
              <Button
                render={<Menu.Trigger />}
                className={button({ variant: "primary", size: "xs" })}
              >
                New Destination
              </Button>
              <Menu.Portal>
                <Menu.Positioner sideOffset={4}>
                  <MenuPopup>{destinationsMenuItems}</MenuPopup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
          }
        />
      );
    }

    return (
      <Card>
        <div className="flex items-center justify-between px-3 py-2">
          <TextLabel>
            {destinationCount === 1
              ? "1 destination"
              : `${destinationCount} destinations`}
          </TextLabel>
          <Menu.Root>
            <GhostButton
              render={<Menu.Trigger />}
              className="flex items-center gap-1"
            >
              <Plus size={12} />
              New Destination
            </GhostButton>
            <Menu.Portal>
              <Menu.Positioner sideOffset={4} align="end">
                <MenuPopup>{destinationsMenuItems}</MenuPopup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
        <div className="border-t border-border divide-y divide-border">
          {connectedDestinations.map((destination) => (
            <DestinationItem
              key={destination.id}
              destination={destination}
              isConnected={true}
              isLoading={loadingProvider === destination.providerId}
              onConnect={() => handleConnect(destination.providerId)}
              onDisconnect={async () =>
                handleDisconnect(destination.providerId)
              }
              syncStatus={getSyncStatus(destination.providerId)}
            />
          ))}
        </div>
      </Card>
    );
  };

  return (
    <Section>
      <SectionHeader
        title="Destinations"
        description="Push your aggregated events to other calendar apps"
      />
      {renderContent()}
    </Section>
  );
};
