"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@base-ui/react/button";
import { Menu } from "@base-ui/react/menu";
import { FREE_DESTINATION_LIMIT } from "@keeper.sh/premium/constants";
import { DESTINATIONS } from "@keeper.sh/destination-metadata";
import type { DestinationConfig } from "@keeper.sh/destination-metadata";
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
import type { SourceDestinationMapping } from "@/hooks/use-mappings";
import type { CalendarSource } from "@/hooks/use-sources";
import { useDestinationsManager } from "@/hooks/use-destinations-manager";
import type { SyncStatusDisplayProps } from "@/hooks/use-destinations-manager";
import { BannerText, TextLabel, TextMeta, TextMuted } from "@/components/typography";
import { button } from "@/styles";
import { track } from "@/lib/analytics";
import { tv } from "tailwind-variants";
import { ChevronDown, ChevronRight, Plus, Server } from "lucide-react";

const syncStatusText = tv({
  slots: {
    skeleton: "absolute inset-0 bg-surface-muted rounded animate-pulse",
    text: "",
  },
  variants: {
    loading: {
      false: { skeleton: "hidden" },
      true: { text: "invisible" },
    },
  },
});

const destinationStatus = tv({
  slots: {
    dot: "size-1.5 rounded-full",
    trigger: "flex items-center gap-1.5",
  },
  variants: {
    needsReauthentication: {
      false: { dot: "bg-success" },
      true: { dot: "bg-warning", trigger: "text-warning" },
    },
  },
});

const isConnectable = (destination: DestinationConfig): boolean => !destination.comingSoon;

const getMenuItemVariant = (comingSoon: boolean): "disabled" | "default" => {
  if (comingSoon) {
    return "disabled";
  }
  return "default";
};

const getImageOpacityClass = (comingSoon: boolean): string => {
  if (comingSoon) {
    return "opacity-50";
  }
  return "";
};

interface DestinationMenuItemProps {
  destination: DestinationConfig;
  onConnect: (providerId: string) => void;
}

const DestinationMenuItemIcon = ({ destination }: { destination: DestinationConfig }): ReactNode => {
  if (destination.icon) {
    return (
      <Image
        src={destination.icon}
        alt={destination.name}
        width={14}
        height={14}
        className={getImageOpacityClass(destination.comingSoon ?? false)}
      />
    );
  }
  return <Server size={14} className="text-foreground-subtle" />;
};

const DestinationMenuItem = ({ destination, onConnect }: DestinationMenuItemProps): ReactNode => {
  const connectable = isConnectable(destination);

  return (
    <MenuItem
      onClick={() => {
        if (!connectable) {
          return;
        }
        track("destination_selected", { provider: destination.id });
        onConnect(destination.id);
      }}
      disabled={destination.comingSoon}
      variant={getMenuItemVariant(destination.comingSoon ?? false)}
      className="py-1.5"
    >
      <DestinationMenuItemIcon destination={destination} />
      <span>{destination.name}</span>
      {destination.comingSoon && <span className="ml-4 text-xs">Unavailable</span>}
    </MenuItem>
  );
};

interface DestinationsMenuProps {
  onConnect: (providerId: string) => void;
}

const DestinationsMenu = ({ onConnect }: DestinationsMenuProps): ReactNode => (
  <>
    {DESTINATIONS.map((destination) => (
      <DestinationMenuItem key={destination.id} destination={destination} onConnect={onConnect} />
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
}: SourcesSubmenuProps): ReactNode => {
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
}: DestinationActionProps): ReactNode => {
  if (comingSoon) {
    return <TextMuted className="ml-auto px-2 py-1 text-xs">Coming soon</TextMuted>;
  }

  if (!isConnected) {
    const getConnectButtonText = (): string => {
      if (isLoading) {
        return "...";
      }
      return "Connect";
    };
    const connectButtonText = getConnectButtonText();
    return (
      <GhostButton onClick={onConnect} disabled={isLoading} className="ml-auto">
        {connectButtonText}
      </GhostButton>
    );
  }

  const getStatusText = (): string => {
    if (needsReauthentication) {
      return "Needs Reauthentication";
    }
    return "Connected";
  };
  const statusText = getStatusText();
  const { trigger, dot } = destinationStatus({ needsReauthentication });
  const getDisplayText = (): string => {
    if (isLoading) {
      return "...";
    }
    return statusText;
  };
  const displayText = getDisplayText();

  return (
    <Menu.Root>
      <GhostButton render={<Menu.Trigger />} disabled={isLoading} className={trigger()}>
        {!isLoading && <span className={dot()} />}
        {displayText}
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

interface SyncStatusTextProps {
  syncStatus: SyncStatusDisplayProps | null;
}

interface SyncProgressProps {
  current: number;
  total: number;
}

const SyncProgress = ({ current, total }: SyncProgressProps): ReactNode => (
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

const SyncedCount = ({ count }: SyncedCountProps): ReactNode => <>{count} events synced</>;

const SyncStatusText = ({ syncStatus }: SyncStatusTextProps): ReactNode => {
  const hasReceivedStatus = useRef(false);
  if (syncStatus) {
    hasReceivedStatus.current = true;
  }

  const loading = !hasReceivedStatus.current;
  const { text, skeleton } = syncStatusText({ loading });

  const getProgress = (): { current: number; total: number } | null => {
    if (
      syncStatus?.status === "syncing" &&
      syncStatus.stage === "processing" &&
      syncStatus.progress &&
      syncStatus.progress.total > 0
    ) {
      return syncStatus.progress;
    }
    return null;
  };
  const progress = getProgress();

  const getStatusContent = (): ReactNode => {
    if (progress) {
      return <SyncProgress current={progress.current} total={progress.total} />;
    }
    return <SyncedCount count={syncStatus?.remoteCount ?? 0} />;
  };
  const statusContent = getStatusContent();

  return (
    <TextMeta className="relative w-fit">
      <span className={text()}>{statusContent}</span>
      <span className={skeleton()} />
    </TextMeta>
  );
};

interface DestinationItemProps {
  destinationId: string;
  destination: DestinationConfig & { name: string };
  syncStatus: SyncStatusDisplayProps | null;
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
}: DestinationItemProps): ReactNode => {
  const { isOpen, isConfirming, open, setIsOpen, confirm } = useConfirmAction();

  const getIconContent = (): ReactNode => {
    if (destination.icon) {
      return <Image src={destination.icon} alt={destination.name} width={14} height={14} />;
    }
    return <Server size={14} className="text-foreground-subtle" />;
  };
  const iconContent = getIconContent();

  return (
    <>
      <div>
        <div className="flex items-center gap-2 px-3 py-2">
          <IconBox>{iconContent}</IconBox>
          <div className="flex-1 min-w-0 flex flex-col">
            <TextLabel as="h2" className="tracking-tight">
              {destination.name}
            </TextLabel>
            {isConnected && !needsReauthentication && <SyncStatusText syncStatus={syncStatus} />}
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
}: NewDestinationMenuProps): ReactNode => (
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

const UpgradeBanner = (): ReactNode => (
  <div className="flex items-center justify-between p-1 pl-3.5 bg-warning-surface border border-warning-border rounded-lg">
    <BannerText variant="warning" className="text-xs">
      You've reached the free plan limit of {FREE_DESTINATION_LIMIT} destination.
    </BannerText>
    <Link href="/dashboard/billing" className={button({ size: "xs", variant: "primary" })}>
      Upgrade to Pro
    </Link>
  </div>
);

export const DestinationsSection = (): ReactNode => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toastManager = Toast.useToastManager();

  const onToast = useCallback(
    (message: string) => toastManager.add({ title: message }),
    [toastManager],
  );

  const onNavigate = useCallback((url: string) => {
    window.location.href = url;
  }, []);

  const {
    accounts,
    sources,
    mappings,
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
    setCaldavDialogOpen,
    getDestinationConfig,
    getSyncStatus,
  } = useDestinationsManager({ onNavigate, onToast });

  const error = searchParams.get("error");
  const errorHandled = useRef(false);

  useEffect(() => {
    if (error && !errorHandled.current) {
      errorHandled.current = true;
      toastManager.add({ title: error });
      router.replace("/dashboard/integrations");
    }
  }, [error, toastManager, router]);

  const renderDestinationItems = (): ReactNode[] => {
    const items: React.ReactNode[] = [];
    for (const account of accounts ?? []) {
      const config = getDestinationConfig(account.providerId);
      if (!config) {
        continue;
      }
      items.push(
        <DestinationItem
          key={account.id}
          destinationId={account.id}
          destination={{
            ...config,
            name: account.email ?? config.name,
          }}
          isConnected
          needsReauthentication={account.needsReauthentication}
          isLoading={loadingId === account.id}
          sources={sources}
          mappings={mappings}
          onConnect={() => handleConnect(config.id, account.id)}
          onDisconnect={() => handleDisconnect(account.id, config.name)}
          onToggleSource={(sourceId) => handleToggleSource(account.id, sourceId)}
          syncStatus={getSyncStatus(account.id)}
        />,
      );
    }
    return items;
  };

  const renderContent = (): ReactNode => {
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
                  className={button({ size: "xs", variant: "primary" })}
                >
                  New Destination
                </Button>
              }
            />
          }
        />
      );
    }

    const getCountLabel = (): string => {
      if (destinationCount === 1) {
        return "1 destination";
      }
      return `${destinationCount} destinations`;
    };
    const countLabel = getCountLabel();

    return (
      <Card>
        <div className="flex items-center justify-between px-3 py-2">
          <TextLabel>{countLabel}</TextLabel>
          {!isAtLimit && (
            <NewDestinationMenu
              onConnect={handleConnect}
              align="end"
              trigger={
                <GhostButton render={<Menu.Trigger />} className="flex items-center gap-1">
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
