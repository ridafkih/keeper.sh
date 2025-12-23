"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@base-ui/react/button";
import { FREE_SOURCE_LIMIT } from "@keeper.sh/premium/constants";
import { Toast } from "@/components/toast-provider";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormDialog } from "@/components/form-dialog";
import { FormField } from "@/components/form-field";
import { SectionHeader } from "@/components/section-header";
import { useSources, type CalendarSource } from "@/hooks/use-sources";
import { useSubscription } from "@/hooks/use-subscription";
import { useLinkedAccounts } from "@/hooks/use-linked-accounts";
import { useSyncStatus } from "@/hooks/use-sync-status";
import { useIcalToken } from "@/hooks/use-ical-token";
import { authClient } from "@/lib/auth-client";
import {
  button,
  input,
  integrationCard,
  integrationIcon,
  integrationInfo,
  integrationName,
  integrationDescription,
} from "@/styles";
import { TextBody, TextMuted, BannerText } from "@/components/typography";

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
      <div className={integrationCard()}>
        <div className={integrationInfo()}>
          <div className={integrationName()}>{source.name}</div>
          <div className={integrationDescription()}>{source.url}</div>
        </div>
        <Button
          onClick={() => setIsConfirmOpen(true)}
          className={button({ variant: "secondary" })}
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

interface SourcesListProps {
  sources: CalendarSource[] | undefined;
  isLoading: boolean;
  onRemove: (id: string) => Promise<void>;
}

const SourcesList = ({ sources, isLoading, onRemove }: SourcesListProps) => {
  if (isLoading) {
    return <TextBody className="py-4">Loading...</TextBody>;
  }

  if (!sources?.length) {
    return <TextBody className="py-4">No calendar sources added yet</TextBody>;
  }

  return (
    <>
      {sources.map((source) => (
        <SourceItem
          key={source.id}
          source={source}
          onRemove={() => onRemove(source.id)}
        />
      ))}
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
      trigger={
        <Button className={button({ variant: "secondary" })}>
          Add iCal Link
        </Button>
      }
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

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Calendar Sources"
        description="Add iCal links to import events from other calendars"
      />
      <div className="flex flex-col gap-1.5">
        <SourcesList
          sources={sources}
          isLoading={isLoading}
          onRemove={handleRemoveSource}
        />
        {isAtLimit && <UpgradeBanner />}
        {!isAtLimit && (
          <AddSourceDialog
            open={isDialogOpen}
            onOpenChange={setIsDialogOpen}
            onAdd={handleAddSource}
          />
        )}
      </div>
    </section>
  );
};

type SupportedProvider = "google";

interface BaseDestination {
  id: string;
  name: string;
  description: string;
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
    description: "Sync your aggregated events to Google Calendar",
    icon: "/integrations/icon-google.svg",
    pushesEvents: true,
  },
  {
    id: "outlook",
    name: "Outlook",
    description: "Sync your aggregated events to Outlook",
    icon: "/integrations/icon-outlook.svg",
    comingSoon: true,
    pushesEvents: true,
  },
  {
    id: "caldav",
    name: "CalDAV",
    description: "Sync to any CalDAV-compatible server",
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
    return <TextMuted>Coming soon</TextMuted>;
  }

  if (isConnected) {
    return (
      <Button
        onClick={onDisconnect}
        disabled={isLoading}
        className={button({ variant: "secondary" })}
      >
        {isLoading ? "..." : "Disconnect"}
      </Button>
    );
  }

  return (
    <Button
      onClick={onConnect}
      disabled={isLoading}
      className={button({ variant: "secondary" })}
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
  fetching: "Fetching remote events",
  comparing: "Comparing events",
  processing: "Processing",
};

const formatOperationType = (type: "add" | "remove"): string => {
  return type === "add" ? "Adding" : "Removing";
};

const formatEventTime = (isoTime: string): string => {
  const date = new Date(isoTime);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

const SyncStatusDisplay = ({
  status,
  stage,
  localCount,
  remoteCount,
  progress,
  lastOperation,
  inSync,
}: SyncStatusDisplayProps) => {
  if (status === "syncing" && stage) {
    const baseLabel = STAGE_LABELS[stage] ?? "Syncing";

    if (stage === "processing" && lastOperation && progress) {
      const operationLabel = formatOperationType(lastOperation.type);
      const timeLabel = formatEventTime(lastOperation.eventTime);
      return (
        <TextMuted>
          {operationLabel} event at {timeLabel} ({progress.current + 1}/
          {progress.total})
        </TextMuted>
      );
    }

    if (progress && progress.total > 0) {
      return (
        <TextMuted>
          {baseLabel} ({progress.current}/{progress.total})
        </TextMuted>
      );
    }
    return <TextMuted>{baseLabel}...</TextMuted>;
  }

  return (
    <TextMuted>
      {inSync
        ? `${remoteCount} events synced`
        : `${remoteCount}/${localCount} events`}
    </TextMuted>
  );
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
      <div className={integrationCard()}>
        <div className={integrationIcon()}>
          {destination.icon && (
            <Image
              src={destination.icon}
              alt={destination.name}
              width={20}
              height={20}
            />
          )}
        </div>
        <div className={integrationInfo()}>
          <div className={integrationName()}>{destination.name}</div>
          <div className={integrationDescription()}>
            {destination.description}
          </div>
          {isConnected && syncStatus && <SyncStatusDisplay {...syncStatus} />}
        </div>
        <DestinationAction
          comingSoon={destination.comingSoon}
          isConnected={isConnected}
          isLoading={isLoading}
          onConnect={onConnect}
          onDisconnect={() => setIsConfirmOpen(true)}
        />
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
  const { data: accounts, mutate: mutateAccounts } = useLinkedAccounts();
  const { data: syncStatus } = useSyncStatus();

  const isProviderConnected = (providerId: SupportedProvider) =>
    accounts?.some((account) => account.providerId === providerId) ?? false;

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

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Destinations"
        description="Push your aggregated events to other calendar apps"
      />
      <div className="flex flex-col gap-1.5">
        {DESTINATIONS.map((destination) => {
          const connectable = isConnectable(destination);
          return (
            <DestinationItem
              key={destination.id}
              destination={destination}
              isConnected={
                connectable && isProviderConnected(destination.providerId)
              }
              isLoading={
                connectable && loadingProvider === destination.providerId
              }
              onConnect={() =>
                connectable && handleConnect(destination.providerId)
              }
              onDisconnect={async () => {
                if (connectable) await handleDisconnect(destination.providerId);
              }}
              syncStatus={
                connectable ? getSyncStatus(destination.providerId) : undefined
              }
            />
          );
        })}
      </div>
    </section>
  );
};

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "";

export const ICalLinkSection = () => {
  const toastManager = Toast.useToastManager();
  const { token, isLoading } = useIcalToken();

  const icalUrl = token
    ? new URL(`/cal/${token}.ics`, BASE_URL).toString()
    : "";

  const copyToClipboard = async () => {
    if (!icalUrl) return;
    await navigator.clipboard.writeText(icalUrl);
    toastManager.add({ title: "Copied to clipboard" });
  };

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Your iCal Link"
        description="Subscribe to this link to view your aggregated events"
      />
      <div className="flex gap-2">
        <input
          type="text"
          value={isLoading ? "Loading..." : icalUrl}
          readOnly
          className={input({ readonly: true, className: "flex-1" })}
        />
        <Button
          onClick={copyToClipboard}
          disabled={isLoading || !token}
          className={button({ variant: "secondary" })}
        >
          Copy
        </Button>
      </div>
    </section>
  );
};
