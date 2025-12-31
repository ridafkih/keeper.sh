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
import { MenuCheckboxItem } from "@/components/menu-checkbox-item";
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
import {
  useMappings,
  updateSourceDestinations,
  type SourceDestinationMapping,
} from "@/hooks/use-mappings";
import { useSources, type CalendarSource } from "@/hooks/use-sources";
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
import { Server, Plus, ChevronRight, ChevronDown } from "lucide-react";

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

const destinationStatus = tv({
  slots: {
    trigger: "flex items-center gap-1.5",
    dot: "size-1.5 rounded-full",
  },
  variants: {
    needsReauthentication: {
      true: { trigger: "text-warning", dot: "bg-warning" },
      false: { dot: "bg-success" },
    },
  },
});

type CalDAVProvider = "fastmail" | "icloud" | "caldav";

const isCalDAVProvider = (provider: string): provider is CalDAVProvider =>
  isCalDAVDestination(provider);

const isConnectable = (destination: DestinationConfig): boolean =>
  !destination.comingSoon;

interface DestinationMenuItemProps {
  destination: DestinationConfig;
  onConnect: (providerId: string) => void;
}

const DestinationMenuItem = ({
  destination,
  onConnect,
}: DestinationMenuItemProps) => {
  const connectable = isConnectable(destination);

  return (
    <MenuItem
      onClick={() => connectable && onConnect(destination.id)}
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
};

interface DestinationsMenuProps {
  onConnect: (providerId: string) => void;
}

const DestinationsMenu = ({ onConnect }: DestinationsMenuProps) => (
  <>
    {DESTINATIONS.map((destination) => (
      <DestinationMenuItem
        key={destination.id}
        destination={destination}
        onConnect={onConnect}
      />
    ))}
  </>
);

interface SourcesSubmenuProps {
  destinationId: string;
  sources: CalendarSource[];
  mappings: SourceDestinationMapping[];
  onToggleSource: (sourceId: string) => void;
}

const SourcesSubmenu = ({
  destinationId,
  sources,
  mappings,
  onToggleSource,
}: SourcesSubmenuProps) => {
  const enabledSourceIds = new Set<string>();
  for (const mapping of mappings) {
    if (mapping.destinationId === destinationId) {
      enabledSourceIds.add(mapping.sourceId);
    }
  }

  if (sources.length === 0) {
    return (
      <MenuItem variant="disabled">
        <span>No sources available</span>
      </MenuItem>
    );
  }

  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger className="flex items-center justify-between gap-2 px-2 py-1 text-xs rounded text-foreground-secondary hover:bg-surface-muted cursor-pointer w-full">
        <span>Sources</span>
        <ChevronRight size={12} />
      </Menu.SubmenuTrigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={0} alignOffset={-4}>
          <MenuPopup minWidth="md">
            {sources.map((source) => (
              <MenuCheckboxItem
                key={source.id}
                checked={enabledSourceIds.has(source.id)}
                onCheckedChange={() => onToggleSource(source.id)}
              >
                {source.name}
              </MenuCheckboxItem>
            ))}
          </MenuPopup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
};

interface DestinationActionProps {
  destinationId: string;
  comingSoon?: boolean;
  isConnected: boolean;
  needsReauthentication: boolean;
  isLoading: boolean;
  sources: CalendarSource[];
  mappings: SourceDestinationMapping[];
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleSource: (sourceId: string) => void;
}

const DestinationAction = ({
  destinationId,
  comingSoon,
  isConnected,
  needsReauthentication,
  isLoading,
  sources,
  mappings,
  onConnect,
  onDisconnect,
  onToggleSource,
}: DestinationActionProps) => {
  if (comingSoon) {
    return (
      <TextMuted className="ml-auto px-2 py-1 text-xs">Coming soon</TextMuted>
    );
  }

  if (!isConnected) {
    return (
      <GhostButton onClick={onConnect} disabled={isLoading} className="ml-auto">
        {isLoading ? "..." : "Connect"}
      </GhostButton>
    );
  }

  const statusText = needsReauthentication
    ? "Needs Reauthentication"
    : "Connected";
  const { trigger, dot } = destinationStatus({ needsReauthentication });

  return (
    <Menu.Root>
      <GhostButton
        render={<Menu.Trigger />}
        disabled={isLoading}
        className={trigger()}
      >
        {!isLoading && <span className={dot()} />}
        {isLoading ? "..." : statusText}
        <ChevronDown size={12} />
      </GhostButton>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align="end">
          <MenuPopup minWidth="md">
            <SourcesSubmenu
              destinationId={destinationId}
              sources={sources}
              mappings={mappings}
              onToggleSource={onToggleSource}
            />
            <MenuItem onClick={onConnect}>Reauthenticate</MenuItem>
            <MenuItem variant="danger" onClick={onDisconnect}>
              Disconnect
            </MenuItem>
          </MenuPopup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
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

interface SyncProgressProps {
  current: number;
  total: number;
}

const SyncProgress = ({ current, total }: SyncProgressProps) => (
  <>
    Syncing (
    <span className="tabular-nums">
      {current}/{total}
    </span>
    )
  </>
);

interface SyncedCountProps {
  count: number;
}

const SyncedCount = ({ count }: SyncedCountProps) => <>{count} events synced</>;

const SyncStatusText = ({ syncStatus }: SyncStatusTextProps) => {
  const hasReceivedStatus = useRef(false);
  if (syncStatus) hasReceivedStatus.current = true;

  const loading = !hasReceivedStatus.current;
  const { text, skeleton } = syncStatusText({ loading });

  const isProcessing =
    syncStatus?.status === "syncing" &&
    syncStatus.stage === "processing" &&
    syncStatus.progress &&
    syncStatus.progress.total > 0;

  return (
    <TextMeta className="relative w-fit">
      <span className={text()}>
        {isProcessing ? (
          <SyncProgress
            current={syncStatus.progress!.current}
            total={syncStatus.progress!.total}
          />
        ) : (
          <SyncedCount count={syncStatus?.remoteCount ?? 0} />
        )}
      </span>
      <span className={skeleton()} />
    </TextMeta>
  );
};

interface DestinationItemProps {
  destinationId: string;
  destination: DestinationConfig & { name: string };
  syncStatus?: SyncStatusDisplayProps;
  isConnected: boolean;
  needsReauthentication: boolean;
  isLoading: boolean;
  sources: CalendarSource[];
  mappings: SourceDestinationMapping[];
  onConnect: () => void;
  onDisconnect: () => Promise<void>;
  onToggleSource: (sourceId: string) => void;
}

const DestinationItem = ({
  destinationId,
  destination,
  isConnected,
  needsReauthentication,
  isLoading,
  sources,
  mappings,
  onConnect,
  onDisconnect,
  onToggleSource,
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
            destinationId={destinationId}
            comingSoon={destination.comingSoon}
            isConnected={isConnected}
            needsReauthentication={needsReauthentication}
            isLoading={isLoading}
            sources={sources}
            mappings={mappings}
            onConnect={onConnect}
            onDisconnect={open}
            onToggleSource={onToggleSource}
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

interface NewDestinationMenuProps {
  onConnect: (providerId: string) => void;
  trigger: React.ReactNode;
  align?: "start" | "center" | "end";
}

const NewDestinationMenu = ({
  onConnect,
  trigger,
  align = "start",
}: NewDestinationMenuProps) => (
  <Menu.Root>
    {trigger}
    <Menu.Portal>
      <Menu.Positioner sideOffset={4} align={align}>
        <MenuPopup>
          <DestinationsMenu onConnect={onConnect} />
        </MenuPopup>
      </Menu.Positioner>
    </Menu.Portal>
  </Menu.Root>
);

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
  const { data: sources } = useSources();
  const { data: mappings, mutate: mutateMappings } = useMappings();
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

  const handleToggleSource = async (
    destinationId: string,
    sourceId: string,
  ) => {
    if (!mappings) return;

    const currentDestinations = getDestinationsForSource(sourceId, mappings);
    const isEnabled = currentDestinations.includes(destinationId);

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
  };

  const destinationCount = accounts?.length ?? 0;
  const isEmpty = !isAccountsLoading && destinationCount === 0;

  const renderDestinationItems = () => {
    const items: React.ReactNode[] = [];
    for (const account of accounts ?? []) {
      const config = getDestinationConfig(account.providerId);
      if (!config) continue;
      items.push(
        <DestinationItem
          key={account.id}
          destinationId={account.id}
          destination={{
            ...config,
            name: account.email ?? config.name,
          }}
          isConnected={true}
          needsReauthentication={account.needsReauthentication}
          isLoading={loadingId === account.id}
          sources={sources ?? []}
          mappings={mappings ?? []}
          onConnect={() => handleConnect(config.id, account.id)}
          onDisconnect={() => handleDisconnect(account.id, config.name)}
          onToggleSource={(sourceId) =>
            handleToggleSource(account.id, sourceId)
          }
          syncStatus={getSyncStatus(account.id)}
        />,
      );
    }
    return items;
  };

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
            <NewDestinationMenu
              onConnect={handleConnect}
              trigger={
                <Button
                  render={<Menu.Trigger />}
                  className={button({ variant: "primary", size: "xs" })}
                >
                  New Destination
                </Button>
              }
            />
          }
        />
      );
    }

    const countLabel =
      destinationCount === 1
        ? "1 destination"
        : `${destinationCount} destinations`;

    return (
      <Card>
        <div className="flex items-center justify-between px-3 py-2">
          <TextLabel>{countLabel}</TextLabel>
          {!isAtLimit && (
            <NewDestinationMenu
              onConnect={handleConnect}
              align="end"
              trigger={
                <GhostButton
                  render={<Menu.Trigger />}
                  className="flex items-center gap-1"
                >
                  <Plus size={12} />
                  New Destination
                </GhostButton>
              }
            />
          )}
        </div>
        <div className="border-t border-border divide-y divide-border">
          {renderDestinationItems()}
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
