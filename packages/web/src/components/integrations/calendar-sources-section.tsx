"use client";

import { useState, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@base-ui/react/button";
import { TextLink } from "@/components/text-link";
import { FREE_SOURCE_LIMIT } from "@keeper.sh/premium/constants";
import { HTTP_STATUS } from "@keeper.sh/constants";
import { Card } from "@/components/card";
import { EmptyState } from "@/components/empty-state";
import { GhostButton } from "@/components/ghost-button";
import { ListSkeleton } from "@/components/list-skeleton";
import { Toast } from "@/components/toast-provider";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormDialog } from "@/components/form-dialog";
import { FormField } from "@/components/form-field";
import { IconBox } from "@/components/icon-box";
import { Section } from "@/components/section";
import { SectionHeader } from "@/components/section-header";
import { BannerText, TextCaption, TextLabel } from "@/components/typography";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { useAllSources } from "@/hooks/use-all-sources";
import type { UnifiedSource, SourceType } from "@/hooks/use-all-sources";
import { useSubscription } from "@/hooks/use-subscription";
import { button } from "@/styles";
import { track } from "@/lib/analytics";
import { NewSourceMenu } from "./add-source-dialog";
import { CalDAVSourceDialog } from "./caldav-source-dialog";
import type { CalDAVSourceProvider } from "./caldav-source-dialog";
import { OAuthSourceCalendarDialog } from "./oauth-source-calendar-dialog";
import type { OAuthSourceProvider } from "./oauth-source-calendar-dialog";
import { Menu } from "@base-ui/react/menu";
import { PROVIDER_DEFINITIONS, getProvider } from "@keeper.sh/provider-registry";
import Image from "next/image";
import { Link as LinkIcon, Plus, Calendar, Server } from "lucide-react";

const formatSourceCountLabel = (count: number): string => {
  if (count === 1) {
    return "1 source";
  }
  return `${count} sources`;
};

const getSourceIcon = (type: SourceType): ReactNode => {
  if (type === "ics") {
    return <LinkIcon size={14} className="text-foreground-muted" />;
  }

  const provider = getProvider(type);
  if (provider?.icon) {
    return <Image src={provider.icon} alt={provider.name} width={14} height={14} />;
  }

  return <Server size={14} className="text-foreground-muted" />;
};

const getSourceSubtitle = (source: UnifiedSource): string => {
  if (source.email) {
    return source.email;
  }
  if (source.url) {
    return source.url;
  }
  return source.type;
};

interface SourceItemProps {
  source: UnifiedSource;
  onRemove: () => Promise<void>;
}

const SourceItem = ({ source, onRemove }: SourceItemProps): ReactNode => {
  const { isOpen, isConfirming, open, setIsOpen, confirm } = useConfirmAction();

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2">
        <IconBox>{getSourceIcon(source.type)}</IconBox>
        <div className="flex-1 min-w-0 flex flex-col">
          <TextLabel as="h2" className="tracking-tight">
            {source.name}
          </TextLabel>
          <TextCaption className="truncate">{getSourceSubtitle(source)}</TextCaption>
        </div>
        <GhostButton variant="danger" onClick={open}>
          Remove
        </GhostButton>
      </div>
      <ConfirmDialog
        open={isOpen}
        onOpenChange={setIsOpen}
        title="Remove Calendar Source"
        description={`Are you sure you want to remove "${source.name}"? Events from this source will no longer be synced.`}
        confirmLabel="Remove"
        isConfirming={isConfirming}
        onConfirm={() => confirm(onRemove)}
      />
    </>
  );
};

const UpgradeBanner = (): ReactNode => (
  <div className="flex items-center justify-between p-1 pl-3.5 bg-warning-surface border border-warning-border rounded-lg">
    <BannerText variant="warning" className="text-xs">
      You've reached the free plan limit of {FREE_SOURCE_LIMIT} sources.
    </BannerText>
    <Link href="/dashboard/billing" className={button({ size: "xs", variant: "primary" })}>
      Upgrade to Pro
    </Link>
  </div>
);

interface ICSSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (name: string, url: string) => Promise<{ authRequired?: boolean }>;
}

const buildAuthenticatedUrl = (url: string, username: string, password: string): string => {
  const parsed = new URL(url);
  parsed.username = encodeURIComponent(username);
  parsed.password = encodeURIComponent(password);
  return parsed.toString();
};

interface CredentialsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (username: string, password: string) => Promise<void>;
}

const CredentialsDialog = ({ open, onOpenChange, onSubmit }: CredentialsDialogProps): ReactNode => {
  const { isSubmitting, error, submit } = useFormSubmit<boolean>();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const username = formData.get("username");
    const password = formData.get("password");

    const result = await submit(async () => {
      if (typeof username !== "string" || typeof password !== "string") {
        throw new TypeError("There was an issue with the submitted data");
      }

      await onSubmit(username, password);
      return true;
    });

    if (result) {
      onOpenChange(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Authentication Required"
      description="This calendar requires credentials to access."
      size="md"
      error={error}
      isSubmitting={isSubmitting}
      submitLabel="Add Source"
      submitVariant="primary"
      onSubmit={handleSubmit}
    >
      <FormField
        id="source-username"
        name="username"
        label="Username"
        type="text"
        autoComplete="username"
        required
      />
      <FormField
        id="source-password"
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
      />
    </FormDialog>
  );
};

const ICSSourceDialog = ({ open, onOpenChange, onAdd }: ICSSourceDialogProps): ReactNode => {
  const { isSubmitting, error, submit } = useFormSubmit<boolean>();
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [pendingUrl, setPendingUrl] = useState("");
  const [pendingName, setPendingName] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const name = formData.get("name");
    const url = formData.get("url");

    const result = await submit(async () => {
      if (typeof name !== "string" || typeof url !== "string") {
        throw new TypeError("There was an issue with the submitted data");
      }

      const response = await onAdd(name, url);

      if (response.authRequired) {
        setPendingUrl(url);
        setPendingName(name);
        setCredentialsOpen(true);
        return false;
      }

      return true;
    });

    if (result) {
      onOpenChange(false);
    }
  };

  const handleCredentialsSubmit = async (username: string, password: string): Promise<void> => {
    const authenticatedUrl = buildAuthenticatedUrl(pendingUrl, username, password);
    await onAdd(pendingName, authenticatedUrl);
    onOpenChange(false);
  };

  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Add iCal Source"
        description="Enter an iCal URL to import events from another calendar."
        size="md"
        error={error}
        isSubmitting={isSubmitting}
        submitLabel="Add Source"
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
      <CredentialsDialog
        open={credentialsOpen}
        onOpenChange={setCredentialsOpen}
        onSubmit={handleCredentialsSubmit}
      />
    </>
  );
};

const getRemoveEndpoint = (source: UnifiedSource): string => {
  switch (source.type) {
    case "google": {
      return `/api/sources/google/${source.id}`;
    }
    case "outlook": {
      return `/api/sources/outlook/${source.id}`;
    }
    case "caldav":
    case "fastmail":
    case "icloud": {
      return `/api/sources/caldav/${source.id}`;
    }
    default: {
      return `/api/ics/${source.id}`;
    }
  }
};

interface PendingOAuthSource {
  credentialId: string;
  provider: OAuthSourceProvider;
}

export const CalendarSourcesSection = (): ReactNode => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toastManager = Toast.useToastManager();
  const { data: sources, isLoading, mutate } = useAllSources();
  const { data: subscription } = useSubscription();

  const [isIcsDialogOpen, setIsIcsDialogOpen] = useState(false);
  const [caldavProvider, setCaldavProvider] = useState<CalDAVSourceProvider | null>(null);
  const [pendingOAuthSource, setPendingOAuthSource] = useState<PendingOAuthSource | null>(null);

  const oauthHandled = useRef(false);

  useEffect(() => {
    if (oauthHandled.current) {
      return;
    }

    const source = searchParams.get("source");
    const sourceCredentialId = searchParams.get("sourceCredentialId");
    const provider = searchParams.get("provider");
    const error = searchParams.get("error");

    if (error && source === "error") {
      oauthHandled.current = true;
      toastManager.add({ title: error });
      router.replace("/dashboard/integrations");
      return;
    }

    const isValidOAuthProvider = provider === "google" || provider === "outlook";
    if (source === "connected" && sourceCredentialId && provider && isValidOAuthProvider) {
      oauthHandled.current = true;
      setPendingOAuthSource({ credentialId: sourceCredentialId, provider });
      router.replace("/dashboard/integrations");
    }
  }, [searchParams, toastManager, router]);

  const isAtLimit = subscription?.plan === "free" && sources && sources.length >= FREE_SOURCE_LIMIT;

  const handleSelectSourceType = (type: SourceType): void => {
    track("source_type_selected", { type });

    switch (type) {
      case "ics": {
        setIsIcsDialogOpen(true);
        break;
      }
      case "google": {
        window.location.href = "/api/sources/authorize?provider=google";
        break;
      }
      case "outlook": {
        window.location.href = "/api/sources/authorize?provider=outlook";
        break;
      }
      case "caldav": {
        setCaldavProvider("caldav");
        break;
      }
      case "fastmail": {
        setCaldavProvider("fastmail");
        break;
      }
      case "icloud": {
        setCaldavProvider("icloud");
        break;
      }
    }
  };

  const handleAddIcsSource = async (
    name: string,
    url: string,
  ): Promise<{ authRequired?: boolean }> => {
    const response = await fetch("/api/ics", {
      body: JSON.stringify({ name, url }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (response.status === HTTP_STATUS.PAYMENT_REQUIRED) {
      throw new Error("Source limit reached. Please upgrade to Pro.");
    }

    if (!response.ok) {
      const data = await response.json();

      if (data.authRequired) {
        return { authRequired: true };
      }

      throw new Error(data.error || "Failed to add source");
    }

    await mutate();
    track("source_added", { type: "ics" });
    toastManager.add({ title: "Calendar source added" });
    return {};
  };

  const handleCalDAVSuccess = async (): Promise<void> => {
    await mutate();
    if (caldavProvider) {
      track("source_added", { type: caldavProvider });
    }
    toastManager.add({ title: "Calendar source added" });
  };

  const handleOAuthSourceSuccess = async (): Promise<void> => {
    await mutate();
    if (pendingOAuthSource) {
      track("source_added", { type: pendingOAuthSource.provider });
    }
    toastManager.add({ title: "Calendar source added" });
  };

  const handleRemoveSource = async (source: UnifiedSource): Promise<void> => {
    try {
      const endpoint = getRemoveEndpoint(source);
      const response = await fetch(endpoint, { method: "DELETE" });

      if (response.ok) {
        await mutate();
        track("source_removed", { type: source.type });
        toastManager.add({ title: "Calendar source removed" });
      }
    } catch {
      toastManager.add({ title: "Failed to remove source" });
    }
  };

  const isEmpty = !isLoading && (!sources || sources.length === 0);
  const sourceCount = sources?.length ?? 0;

  const renderContent = (): ReactNode => {
    if (isLoading) {
      return <ListSkeleton rows={2} />;
    }

    if (isEmpty) {
      return (
        <EmptyState
          icon={<Calendar size={16} className="text-foreground-subtle" />}
          message="You don't have any sources yet, add one to start syncing events across your calendars."
          action={
            <div className="flex flex-col items-center gap-2">
              <NewSourceMenu
                onSelect={handleSelectSourceType}
                trigger={
                  <Button
                    render={<Menu.Trigger />}
                    onClick={() => track("source_dropdown_opened")}
                    className={button({ size: "xs", variant: "primary" })}
                  >
                    Add Calendar Source
                  </Button>
                }
              />
              <TextLink href="https://keeper.sh/#how-it-works" target="_blank">
                Learn More
              </TextLink>
            </div>
          }
        />
      );
    }

    const sourceCountLabel = formatSourceCountLabel(sourceCount);

    return (
      <Card>
        <div className="flex items-center justify-between px-3 py-2">
          <TextLabel>{sourceCountLabel}</TextLabel>
          {!isAtLimit && (
            <NewSourceMenu
              onSelect={handleSelectSourceType}
              align="end"
              trigger={
                <GhostButton
                  render={<Menu.Trigger />}
                  onClick={() => track("source_dropdown_opened")}
                  className="flex items-center gap-1"
                >
                  <Plus size={12} />
                  New Source
                </GhostButton>
              }
            />
          )}
        </div>
        {sources && sources.length > 0 && (
          <div className="border-t border-border divide-y divide-border">
            {sources.map((source) => (
              <SourceItem
                key={source.id}
                source={source}
                onRemove={() => handleRemoveSource(source)}
              />
            ))}
          </div>
        )}
      </Card>
    );
  };

  return (
    <Section>
      <SectionHeader
        title="Calendar Sources"
        description="Add calendars from various providers to import events"
      />
      {isAtLimit && <UpgradeBanner />}
      {renderContent()}
      {!isAtLimit && (
        <>
          <ICSSourceDialog
            open={isIcsDialogOpen}
            onOpenChange={setIsIcsDialogOpen}
            onAdd={handleAddIcsSource}
          />
          {caldavProvider && (
            <CalDAVSourceDialog
              open={Boolean(caldavProvider)}
              onOpenChange={(open) => {
                if (!open) {
                  setCaldavProvider(null);
                }
              }}
              provider={caldavProvider}
              onSuccess={handleCalDAVSuccess}
            />
          )}
        </>
      )}
      {pendingOAuthSource && (
        <OAuthSourceCalendarDialog
          open={Boolean(pendingOAuthSource)}
          onOpenChange={(open) => {
            if (!open) {
              setPendingOAuthSource(null);
            }
          }}
          provider={pendingOAuthSource.provider}
          credentialId={pendingOAuthSource.credentialId}
          onSuccess={handleOAuthSourceSuccess}
        />
      )}
    </Section>
  );
};
