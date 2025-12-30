"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@base-ui/react/button";
import { Menu } from "@base-ui/react/menu";
import { FREE_DESTINATION_LIMIT } from "@keeper.sh/premium/constants";
import {
  DESTINATIONS,
  isCalDAVDestination,
  type DestinationConfig,
} from "@keeper.sh/destination-metadata";
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
import { CalDAVConnectDialog } from "@/components/integrations/caldav-connect-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useLinkedAccounts } from "@/hooks/use-linked-accounts";
import { useSubscription } from "@/hooks/use-subscription";
import { useSyncStatus } from "@/hooks/use-sync-status";
import {
  TextLabel,
  TextMeta,
  TextMuted,
  BannerText,
} from "@/components/typography";
import { button } from "@/styles";
import { tv } from "tailwind-variants";
import { Server, Plus } from "lucide-react";

const syncStatusText = tv({
  slots: {
    text: "",
    skeleton: "absolute inset-0 bg-surface-muted rounded animate-pulse",
  },
  variants: {
    loading: {
      true: { text: "invisible" },
      false: { skeleton: "hidden" },
    },
  },
});

type CalDAVProvider = "fastmail" | "icloud" | "caldav";

const isCalDAVProvider = (provider: string): provider is CalDAVProvider =>
  isCalDAVDestination(provider);

const isConnectable = (destination: DestinationConfig): boolean =>
  !destination.comingSoon;

interface DestinationActionProps {
  comingSoon?: boolean;
  isConnected: boolean;
  needsReauthentication: boolean;
  isLoading: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

const DestinationAction = ({
  comingSoon,
  isConnected,
  needsReauthentication,
  isLoading,
  onConnect,
  onDisconnect,
}: DestinationActionProps) => {
  if (comingSoon) {
    return (
      <TextMuted className="ml-auto px-2 py-1 text-xs">Coming soon</TextMuted>
    );
  }

  if (isConnected && needsReauthentication) {
    return (
      <Menu.Root>
        <GhostButton
          render={<Menu.Trigger />}
          disabled={isLoading}
          className="flex items-center gap-1.5 text-warning"
        >
          {!isLoading && <span className="size-1.5 rounded-full bg-warning" />}
          {isLoading ? "..." : "Needs Reauthentication"}
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

interface SyncStatusTextProps {
  syncStatus?: SyncStatusDisplayProps;
}

const SyncStatusText = ({ syncStatus }: SyncStatusTextProps) => {
  const [hasReceivedStatus, setHasReceivedStatus] = useState(false);

  useEffect(() => {
    if (syncStatus) {
      setHasReceivedStatus(true);
    }
  }, [syncStatus]);

  const displayCount = syncStatus?.remoteCount ?? 0;
  const loading = !hasReceivedStatus;
  const isProcessing =
    syncStatus?.status === "syncing" && syncStatus.stage === "processing";
  const { text, skeleton } = syncStatusText({ loading });

  const content =
    isProcessing && syncStatus?.progress && syncStatus.progress.total > 0 ? (
      <>
        Syncing (
        <span className="tabular-nums">
          {syncStatus.progress.current}/{syncStatus.progress.total}
        </span>
        )
      </>
    ) : (
      <>{displayCount} events synced</>
    );

  return (
    <TextMeta className="relative w-fit">
      <span className={text()}>{content}</span>
      <span className={skeleton()} />
    </TextMeta>
  );
};

interface DestinationItemProps {
  destination: DestinationConfig & { name: string };
  syncStatus?: SyncStatusDisplayProps;
  isConnected: boolean;
  needsReauthentication: boolean;
  isLoading: boolean;
  onConnect: () => void;
  onDisconnect: () => Promise<void>;
}

const DestinationItem = ({
  destination,
  isConnected,
  needsReauthentication,
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
            {isConnected && !needsReauthentication && (
              <SyncStatusText syncStatus={syncStatus} />
            )}
          </div>
          <DestinationAction
            comingSoon={destination.comingSoon}
            isConnected={isConnected}
            needsReauthentication={needsReauthentication}
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
        description={`Synced events will remain on ${destination.name}. Remove sources first to clear them.`}
        confirmLabel="Disconnect"
        isConfirming={isConfirming}
        onConfirm={() => confirm(onDisconnect)}
        requirePhrase="I understand"
      />
    </>
  );
};

const UpgradeBanner = () => (
  <div className="flex items-center justify-between p-1 pl-3.5 bg-warning-surface border border-warning-border rounded-lg">
    <BannerText variant="warning" className="text-xs">
      You've reached the free plan limit of {FREE_DESTINATION_LIMIT}{" "}
      destination.
    </BannerText>
    <Link
      href="/dashboard/billing"
      className={button({ variant: "primary", size: "xs" })}
    >
      Upgrade to Pro
    </Link>
  </div>
);

export const DestinationsSection = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toastManager = Toast.useToastManager();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [caldavDialogOpen, setCaldavDialogOpen] = useState(false);
  const [caldavProvider, setCaldavProvider] = useState<CalDAVProvider | null>(
    null,
  );
  const {
    data: accounts,
    isLoading: isAccountsLoading,
    mutate: mutateAccounts,
  } = useLinkedAccounts();
  const { data: subscription } = useSubscription();
  const { data: syncStatus } = useSyncStatus();

  const workingAccountsCount =
    accounts?.filter((account) => !account.needsReauthentication).length ?? 0;
  const isAtLimit =
    subscription?.plan === "free" &&
    workingAccountsCount >= FREE_DESTINATION_LIMIT;

  const error = searchParams.get("error");
  const errorHandled = useRef(false);

  useEffect(() => {
    if (error && !errorHandled.current) {
      errorHandled.current = true;
      toastManager.add({ title: error });
      router.replace("/dashboard/integrations");
    }
  }, [error]);

  const getDestinationConfig = (
    providerId: string,
  ): DestinationConfig | undefined => {
    return DESTINATIONS.find(
      (destination) =>
        isConnectable(destination) && destination.id === providerId,
    );
  };

  const getSyncStatus = (
    destinationId: string,
  ): SyncStatusDisplayProps | undefined => {
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
  };

  const handleConnect = (providerId: string, destinationId?: string) => {
    if (isCalDAVProvider(providerId)) {
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
    window.location.href = url.toString();
  };

  const handleCaldavSuccess = async () => {
    await mutateAccounts();
    toastManager.add({ title: "Calendar connected successfully" });
  };

  const handleDisconnect = async (
    destinationId: string,
    providerName: string,
  ) => {
    setLoadingId(destinationId);
    try {
      const response = await fetch(`/api/destinations/${destinationId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to disconnect");
      }

      await mutateAccounts();
      toastManager.add({ title: `Disconnected from ${providerName}` });
    } catch {
      toastManager.add({ title: `Failed to disconnect` });
    } finally {
      setLoadingId(null);
    }
  };

  const destinationCount = accounts?.length ?? 0;
  const isEmpty = !isAccountsLoading && destinationCount === 0;

  const destinationsMenuItems = DESTINATIONS.map((destination) => {
    const connectable = isConnectable(destination);
    return (
      <MenuItem
        key={destination.id}
        onClick={() => connectable && handleConnect(destination.id)}
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
          {!isAtLimit && (
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
          )}
        </div>
        <div className="border-t border-border divide-y divide-border">
          {accounts?.map((account) => {
            const config = getDestinationConfig(account.providerId);
            if (!config) return null;
            return (
              <DestinationItem
                key={account.id}
                destination={{
                  ...config,
                  name: account.email ?? config.name,
                }}
                isConnected={true}
                needsReauthentication={account.needsReauthentication}
                isLoading={loadingId === account.id}
                onConnect={() => handleConnect(config.id, account.id)}
                onDisconnect={() => handleDisconnect(account.id, config.name)}
                syncStatus={getSyncStatus(account.id)}
              />
            );
          })}
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
      {isAtLimit && <UpgradeBanner />}
      {renderContent()}
      {caldavProvider && (
        <CalDAVConnectDialog
          open={caldavDialogOpen}
          onOpenChange={setCaldavDialogOpen}
          provider={caldavProvider}
          onSuccess={handleCaldavSuccess}
        />
      )}
    </Section>
  );
};
