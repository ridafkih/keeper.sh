"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@base-ui/react/button";
import { Menu } from "@base-ui/react/menu";
import { FREE_SOURCE_LIMIT } from "@keeper.sh/premium/constants";
import { Toast } from "@/components/toast-provider";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormDialog } from "@/components/form-dialog";
import { FormField } from "@/components/form-field";
import { Section } from "@/components/section";
import { SectionHeader } from "@/components/section-header";
import { useSources, type CalendarSource } from "@/hooks/use-sources";
import { useSubscription } from "@/hooks/use-subscription";
import { useLinkedAccounts } from "@/hooks/use-linked-accounts";
import { useSyncStatus } from "@/hooks/use-sync-status";
import { useIcalToken } from "@/hooks/use-ical-token";
import { authClient } from "@/lib/auth-client";
import { button, input } from "@/styles";
import { BannerText } from "@/components/typography";
import { Link as LinkIcon, Server, Check, Plus } from "lucide-react";

interface SourceItemProps {
  source: CalendarSource;
  onRemove: () => Promise<void>;
}

const SourceItem = ({ source, onRemove }: SourceItemProps) => {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  const handleConfirm = async () => {
    setIsRemoving(true);
    await onRemove();
    setIsRemoving(false);
    setIsConfirmOpen(false);
  };

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="size-8 grid place-items-center rounded bg-zinc-100 shrink-0">
          <LinkIcon size={14} className="text-zinc-500" />
        </div>
        <div className="flex-1 min-w-0 flex flex-col">
          <h2 className="text-sm tracking-tight font-medium">{source.name}</h2>
          <span className="block text-xs tracking-tight text-zinc-500 truncate">
            {source.url}
          </span>
        </div>
        <Button
          className="text-xs text-red-600 hover:text-red-700 hover:bg-zinc-50 cursor-pointer px-2 py-1 rounded-md"
          onClick={() => setIsConfirmOpen(true)}
        >
          Remove
        </Button>
      </div>
      <ConfirmDialog
        open={isConfirmOpen}
        onOpenChange={setIsConfirmOpen}
        title="Remove Calendar Source"
        description={`Are you sure you want to remove "${source.name}"? Events from this source will no longer be synced.`}
        confirmLabel="Remove"
        confirmingLabel="Removing..."
        isConfirming={isRemoving}
        onConfirm={handleConfirm}
      />
    </>
  );
};

const UpgradeBanner = () => (
  <div className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-lg">
    <BannerText variant="warning">
      You've reached the free plan limit of {FREE_SOURCE_LIMIT} sources.
    </BannerText>
    <Link href="/dashboard/billing" className={button({ variant: "primary" })}>
      Upgrade to Pro
    </Link>
  </div>
);

const AddSourceDialog = ({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (name: string, url: string) => Promise<void>;
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");

    const formData = new FormData(event.currentTarget);
    const name = formData.get("name") ?? "";
    const url = formData.get("url") ?? "";

    try {
      if (typeof name !== "string" || typeof url !== "string") {
        throw Error("There was an issue with the submitted data");
      }

      await onAdd(name, url);
      onOpenChange(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to add source");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add Calendar Source"
      description="Enter an iCal URL to import events from another calendar."
      size="md"
      error={error}
      isSubmitting={isSubmitting}
      submitLabel="Add Source"
      submittingLabel="Adding..."
      submitVariant="primary"
      onSubmit={handleSubmit}
    >
      <FormField
        id="source-name"
        name="name"
        label="Name"
        type="text"
        placeholder="Work Calendar"
        autoComplete="off"
        required
      />
      <FormField
        id="source-url"
        name="url"
        label="iCal URL"
        type="url"
        placeholder="https://calendar.google.com/calendar/ical/..."
        autoComplete="off"
        required
      />
    </FormDialog>
  );
};

export const CalendarSourcesSection = () => {
  const toastManager = Toast.useToastManager();
  const { data: sources, isLoading, mutate } = useSources();
  const { data: subscription } = useSubscription();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const isAtLimit =
    subscription?.plan === "free" &&
    (sources?.length ?? 0) >= FREE_SOURCE_LIMIT;

  const handleAddSource = async (name: string, url: string) => {
    const response = await fetch("/api/ics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, url }),
    });

    if (response.status === 402) {
      throw new Error("Source limit reached. Please upgrade to Pro.");
    }

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to add source");
    }

    await mutate();
    toastManager.add({ title: "Calendar source added" });
  };

  const handleRemoveSource = async (id: string) => {
    try {
      const response = await fetch(`/api/ics/${id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        await mutate();
        toastManager.add({ title: "Calendar source removed" });
      }
    } catch {
      toastManager.add({ title: "Failed to remove source" });
    }
  };

  const countLabel = isLoading
    ? "Loading..."
    : sources?.length === 1
      ? "1 source"
      : `${sources?.length ?? 0} sources`;

  return (
    <Section>
      <SectionHeader
        title="Calendar Sources"
        description="Add iCal links to import events from other calendars"
      />
      <div className="border border-zinc-200 rounded-md">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-sm font-medium text-zinc-900">
            {countLabel}
          </span>
          <button
            onClick={() => setIsDialogOpen(true)}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 cursor-pointer px-2 py-1 rounded-md"
          >
            <Plus size={12} />
            New Source
          </button>
        </div>
        {sources && sources.length > 0 && (
          <div className="border-t border-zinc-200 divide-y divide-zinc-200">
            {sources.map((source) => (
              <SourceItem
                key={source.id}
                source={source}
                onRemove={() => handleRemoveSource(source.id)}
              />
            ))}
          </div>
        )}
      </div>
      {isAtLimit && <UpgradeBanner />}
      {!isAtLimit && (
        <AddSourceDialog
          open={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          onAdd={handleAddSource}
        />
      )}
    </Section>
  );
};

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
      <span className="text-xs text-zinc-400 ml-auto px-2 py-1">
        Coming soon
      </span>
    );
  }

  if (isConnected) {
    return (
      <Menu.Root>
        <Menu.Trigger
          disabled={isLoading}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 cursor-pointer px-2 py-1 rounded-md disabled:opacity-50"
        >
          {!isLoading && (
            <span className="size-1.5 rounded-full bg-green-500" />
          )}
          {isLoading ? "..." : "Connected"}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={4} align="end">
            <Menu.Popup className="bg-white border border-zinc-200 rounded-md shadow-lg p-1 min-w-[120px]">
              <Menu.Item
                onClick={onConnect}
                className="px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50 cursor-pointer rounded"
              >
                Reauthenticate
              </Menu.Item>
              <Menu.Item
                onClick={onDisconnect}
                className="px-2 py-1 text-xs text-red-600 hover:bg-zinc-50 cursor-pointer rounded"
              >
                Disconnect
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    );
  }

  return (
    <Button
      onClick={onConnect}
      disabled={isLoading}
      className="text-xs text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 active:bg-zinc-100 hover:cursor-pointer ml-auto px-2 py-1 rounded-md disabled:opacity-50"
    >
      {isLoading ? "..." : "Connect"}
    </Button>
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

const SyncStatusText = ({
  syncStatus,
}: {
  syncStatus: SyncStatusDisplayProps;
}) => {
  const isSyncing = syncStatus.status === "syncing" && syncStatus.stage;
  const { progress } = syncStatus;
  const hasProgress = progress && progress.total > 0;

  let label: string;
  if (isSyncing) {
    const stageLabel = STAGE_LABELS[syncStatus.stage!] ?? "Syncing";
    label = hasProgress
      ? `${stageLabel} (${progress.current}/${progress.total})`
      : `${stageLabel}...`;
  } else {
    label = syncStatus.inSync
      ? `${syncStatus.remoteCount} events synced`
      : `${syncStatus.remoteCount}/${syncStatus.localCount} events`;
  }

  return <span className="text-xs text-zinc-500">{label}</span>;
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
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    await onDisconnect();
    setIsDisconnecting(false);
    setIsConfirmOpen(false);
  };

  return (
    <>
      <div>
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="size-8 grid place-items-center rounded bg-zinc-100 shrink-0">
            {destination.icon ? (
              <Image
                src={destination.icon}
                alt={destination.name}
                width={14}
                height={14}
              />
            ) : (
              <Server size={14} className="text-zinc-400" />
            )}
          </div>
          <div className="flex-1 min-w-0 flex flex-col">
            <h2 className="text-sm tracking-tight font-medium">
              {destination.name}
            </h2>
            {isConnected && syncStatus && (
              <SyncStatusText syncStatus={syncStatus} />
            )}
          </div>
          <DestinationAction
            comingSoon={destination.comingSoon}
            isConnected={isConnected}
            isLoading={isLoading}
            onConnect={onConnect}
            onDisconnect={() => setIsConfirmOpen(true)}
          />
        </div>
      </div>
      <ConfirmDialog
        open={isConfirmOpen}
        onOpenChange={setIsConfirmOpen}
        title={`Disconnect ${destination.name}`}
        description={
          destination.pushesEvents
            ? `Synced events will remain on ${destination.name}. Remove sources first to clear them.`
            : `Events will no longer sync to ${destination.name}.`
        }
        confirmLabel="Disconnect"
        confirmingLabel="Disconnecting..."
        isConfirming={isDisconnecting}
        onConfirm={handleDisconnect}
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

  const connectedDestinations = DESTINATIONS.filter(
    (d) => isConnectable(d) && isProviderConnected(d.providerId),
  ) as ConnectableDestination[];

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

  const handleConnect = async (providerId: SupportedProvider) => {
    setLoadingProvider(providerId);
    try {
      await authClient.linkSocial({
        provider: providerId,
        callbackURL: "/dashboard/integrations",
      });
      await mutateAccounts();
      toastManager.add({ title: `Connected to ${providerId}` });
    } catch {
      toastManager.add({ title: `Failed to connect` });
    } finally {
      setLoadingProvider(null);
    }
  };

  const handleDisconnect = async (providerId: SupportedProvider) => {
    setLoadingProvider(providerId);
    try {
      await authClient.unlinkAccount({ providerId });
      await mutateAccounts();
      toastManager.add({ title: `Disconnected from ${providerId}` });
    } catch {
      toastManager.add({ title: `Failed to disconnect` });
    } finally {
      setLoadingProvider(null);
    }
  };

  const countLabel = isAccountsLoading
    ? "Loading..."
    : connectedDestinations.length === 1
      ? "1 destination"
      : `${connectedDestinations.length} destinations`;

  return (
    <Section>
      <SectionHeader
        title="Destinations"
        description="Push your aggregated events to other calendar apps"
      />
      <div className="border border-zinc-200 rounded-md">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-sm font-medium text-zinc-900">
            {countLabel}
          </span>
          <Menu.Root>
            <Menu.Trigger className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 cursor-pointer px-2 py-1 rounded-md">
              <Plus size={12} />
              Add Destination
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner sideOffset={4} align="end">
                <Menu.Popup className="bg-white border border-zinc-200 rounded-md shadow-lg p-1">
                  {DESTINATIONS.map((destination) => {
                    const connectable = isConnectable(destination);
                    return (
                      <Menu.Item
                        key={destination.id}
                        onClick={() =>
                          connectable && handleConnect(destination.providerId)
                        }
                        disabled={destination.comingSoon}
                        className={`flex items-center gap-2 px-2 py-1.5 text-xs rounded ${
                          destination.comingSoon
                            ? "text-zinc-400 cursor-not-allowed"
                            : "text-zinc-600 hover:bg-zinc-50 cursor-pointer"
                        }`}
                      >
                        {destination.icon ? (
                          <Image
                            src={destination.icon}
                            alt={destination.name}
                            width={14}
                            height={14}
                            className={
                              destination.comingSoon ? "opacity-50" : ""
                            }
                          />
                        ) : (
                          <Server size={14} className="text-zinc-400" />
                        )}
                        <span>{destination.name}</span>
                        {destination.comingSoon && (
                          <span className="ml-4 text-xs">Unavailable</span>
                        )}
                      </Menu.Item>
                    );
                  })}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
        {connectedDestinations.length > 0 && (
          <div className="border-t border-zinc-200 divide-y divide-zinc-200">
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
        )}
      </div>
    </Section>
  );
};

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "";

export const ICalLinkSection = () => {
  const toastManager = Toast.useToastManager();
  const { token, isLoading } = useIcalToken();
  const [copied, setCopied] = useState(false);

  const icalUrl = token
    ? new URL(`/cal/${token}.ics`, BASE_URL).toString()
    : "";

  const copyToClipboard = async () => {
    if (!icalUrl) return;
    await navigator.clipboard.writeText(icalUrl);
    toastManager.add({ title: "Copied to clipboard" });
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Section>
      <SectionHeader
        title="Your iCal Link"
        description="Subscribe to this link to view your aggregated events"
      />
      <div className="flex gap-1.5">
        <input
          type="text"
          value={isLoading ? "Loading..." : icalUrl}
          readOnly
          className={input({ readonly: true, size: "sm", className: "flex-1" })}
        />
        <Button
          onClick={copyToClipboard}
          disabled={isLoading || !token}
          className={button({
            variant: "secondary",
            size: "sm",
            className: "relative",
          })}
        >
          <span className={copied ? "invisible" : ""}>Copy</span>
          {copied && <Check size={16} className="absolute inset-0 m-auto" />}
        </Button>
      </div>
    </Section>
  );
};
