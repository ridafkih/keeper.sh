"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
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
import { useSources } from "@/hooks/use-sources";
import type { CalendarSource } from "@/hooks/use-sources";
import { useSubscription } from "@/hooks/use-subscription";
import { button } from "@/styles";
import { track } from "@/lib/analytics";
import { Link as LinkIcon, Plus } from "lucide-react";

const formatSourceCountLabel = (count: number): string => {
  if (count === 1) {
    return "1 source";
  }
  return `${count} sources`;
};

interface SourceItemProps {
  source: CalendarSource;
  onRemove: () => Promise<void>;
}

const SourceItem = ({ source, onRemove }: SourceItemProps): ReactNode => {
  const { isOpen, isConfirming, open, setIsOpen, confirm } = useConfirmAction();

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2">
        <IconBox>
          <LinkIcon size={14} className="text-foreground-muted" />
        </IconBox>
        <div className="flex-1 min-w-0 flex flex-col">
          <TextLabel as="h2" className="tracking-tight">
            {source.name}
          </TextLabel>
          <TextCaption className="truncate">{source.url}</TextCaption>
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

interface AddSourceDialogProps {
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

const AddSourceDialog = ({ open, onOpenChange, onAdd }: AddSourceDialogProps): ReactNode => {
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
        title="Add Calendar Source"
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

export const CalendarSourcesSection = (): ReactNode => {
  const toastManager = Toast.useToastManager();
  const { data: sources, isLoading, mutate } = useSources();
  const { data: subscription } = useSubscription();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const isAtLimit = subscription?.plan === "free" && sources && sources.length >= FREE_SOURCE_LIMIT;

  const handleAddSource = async (
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
    track("source_added", { type: "url" });
    toastManager.add({ title: "Calendar source added" });
    return {};
  };

  const handleRemoveSource = async (id: string): Promise<void> => {
    try {
      const response = await fetch(`/api/ics/${id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        await mutate();
        track("source_removed");
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
          icon={<LinkIcon size={16} className="text-foreground-subtle" />}
          message="You don't have any sources yet, add one to start syncing events across your calendars."
          action={
            <div className="flex flex-col items-center gap-2">
              <Button
                onClick={() => {
                  track("source_dropdown_opened");
                  setIsDialogOpen(true);
                }}
                className={button({ size: "xs", variant: "primary" })}
              >
                Add Calendar Source
              </Button>
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
            <GhostButton
              onClick={() => {
                track("source_dropdown_opened");
                setIsDialogOpen(true);
              }}
              className="flex items-center gap-1"
            >
              <Plus size={12} />
              New Source
            </GhostButton>
          )}
        </div>
        {sources && sources.length > 0 && (
          <div className="border-t border-border divide-y divide-border">
            {sources.map((source) => (
              <SourceItem
                key={source.id}
                source={source}
                onRemove={() => handleRemoveSource(source.id)}
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
        description="Add iCal links to import events from other calendars"
      />
      {isAtLimit && <UpgradeBanner />}
      {renderContent()}
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
