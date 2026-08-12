import { useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import Calendar from "lucide-react/dist/esm/icons/calendar";
import Check from "lucide-react/dist/esm/icons/check";
import Copy from "lucide-react/dist/esm/icons/copy";
import Plus from "lucide-react/dist/esm/icons/plus";
import { Button, ButtonIcon, ButtonText } from "@/components/ui/primitives/button";
import { BackButton } from "@/components/ui/primitives/back-button";
import { Input } from "@/components/ui/primitives/input";
import { DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { ErrorState } from "@/components/ui/primitives/error-state";
import { Text } from "@/components/ui/primitives/text";
import { UpgradeHint } from "@/components/ui/primitives/upgrade-hint";
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalTitle,
} from "@/components/ui/primitives/modal";
import {
  NavigationMenu,
  NavigationMenuButtonItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { createIcalFeed, useIcalFeeds } from "@/hooks/use-ical-feeds";
import type { IcalFeed } from "@/hooks/use-ical-feeds";
import { useEntitlements, useMutateEntitlements } from "@/hooks/use-entitlements";
import { canCreateFeed } from "@/utils/ical-feeds";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { resolveErrorMessage } from "@/utils/errors";
import { useCopiedState } from "@/hooks/use-copied-state";

const SINGLE_CALENDAR_COUNT = 1;

export const Route = createFileRoute("/(dashboard)/dashboard/ical/")({
  component: ICalPage,
});

function resolveCalendarCountLabel(count: number): string {
  if (count === SINGLE_CALENDAR_COUNT) {
    return "1 calendar";
  }
  return `${count} calendars`;
}

function CopyFeedIcon({ copied }: { copied: boolean }) {
  if (copied) {
    return <Check size={16} />;
  }
  return <Copy size={16} />;
}

function FeedCopyButton({ feed }: { feed: IcalFeed }) {
  const { copied, markCopied } = useCopiedState();

  const handleCopy = async (event: React.MouseEvent) => {
    event.stopPropagation();
    await navigator.clipboard.writeText(feed.icalUrl);
    track(ANALYTICS_EVENTS.ical_link_copied);
    markCopied();
  };

  return (
    <Button
      variant="border"
      className="shrink-0 aspect-square"
      onClick={handleCopy}
      aria-label={`Copy the link for ${feed.name}`}
    >
      <ButtonIcon>
        <CopyFeedIcon copied={copied} />
      </ButtonIcon>
    </Button>
  );
}

function FeedListItem({ feed }: { feed: IcalFeed }) {
  const navigate = useNavigate();

  return (
    <NavigationMenuButtonItem
      onClick={() => navigate({ to: "/dashboard/ical/$feedId", params: { feedId: feed.id } })}
    >
      <NavigationMenuItemIcon>
        <Calendar size={15} />
      </NavigationMenuItemIcon>
      <NavigationMenuItemLabel>{feed.name}</NavigationMenuItemLabel>
      <NavigationMenuItemTrailing>
        <Text size="sm" tone="muted">
          {resolveCalendarCountLabel(feed.calendarCount ?? 0)}
        </Text>
        <FeedCopyButton feed={feed} />
      </NavigationMenuItemTrailing>
    </NavigationMenuButtonItem>
  );
}

function ICalPage() {
  const { data: entitlements } = useEntitlements();
  const { revalidateEntitlements } = useMutateEntitlements();
  const { data: feeds = [], error, mutate } = useIcalFeeds();
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const canCreate = canCreateFeed(entitlements);

  return (
    <div className="flex flex-col gap-1.5">
      <BackButton />
      <DashboardSection
        title="iCal Feeds"
        description="Each feed is its own link with its own calendars, privacy settings and filters. Subscribe to a link in any calendar app."
      />
      {error && (
        <ErrorState message="Failed to load iCal feeds." onRetry={() => mutate()} />
      )}
      {mutationError && <Text size="sm" tone="danger">{mutationError}</Text>}
      <NavigationMenu>
        {feeds.map((feed) => (
          <FeedListItem key={feed.id} feed={feed} />
        ))}
        <CreateFeedButton
          disabled={!canCreate}
          createOpen={createOpen}
          setCreateOpen={setCreateOpen}
          onCreated={async () => {
            await mutate();
            await revalidateEntitlements();
          }}
          onError={setMutationError}
        />
      </NavigationMenu>
      {!canCreate && (
        <UpgradeHint>
          Free includes 1 iCal feed. Keeper.sh Pro adds unlimited feeds — share a work-only link
          with a colleague without exposing everything else.
        </UpgradeHint>
      )}
    </div>
  );
}

function CreateSubmitButton({ isCreating }: { isCreating: boolean }) {
  if (isCreating) {
    return (
      <Button type="submit" className="w-full justify-center" disabled>
        <ButtonText>Creating...</ButtonText>
      </Button>
    );
  }

  return (
    <Button type="submit" className="w-full justify-center">
      <ButtonText>Create</ButtonText>
    </Button>
  );
}

function CreateFeedButton({
  disabled,
  createOpen,
  setCreateOpen,
  onCreated,
  onError,
}: {
  disabled: boolean;
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
  onCreated: () => Promise<void>;
  onError: (error: string | null) => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [isCreating, setIsCreating] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = nameRef.current?.value?.trim();
    if (!name) return;
    onError(null);
    setIsCreating(true);
    try {
      const created = await createIcalFeed(name);
      track(ANALYTICS_EVENTS.ical_feed_created);
      setCreateOpen(false);
      await onCreated();
      await navigate({ to: "/dashboard/ical/$feedId", params: { feedId: created.id } });
    } catch (err) {
      onError(resolveErrorMessage(err, "Failed to create feed."));
      setCreateOpen(false);
      await onCreated();
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      <NavigationMenuButtonItem disabled={disabled} onClick={() => setCreateOpen(true)}>
        <NavigationMenuItemIcon>
          <Plus size={15} />
        </NavigationMenuItemIcon>
        <NavigationMenuItemLabel>Create Feed</NavigationMenuItemLabel>
      </NavigationMenuButtonItem>
      <Modal open={createOpen} onOpenChange={setCreateOpen}>
        <ModalContent>
          <form onSubmit={handleSubmit} className="contents">
            <ModalTitle>Create iCal feed</ModalTitle>
            <ModalDescription>
              Give the feed a name so you remember who you shared it with.
            </ModalDescription>
            <Input ref={nameRef} name="name" placeholder="Feed name" autoFocus />
            <ModalFooter>
              <CreateSubmitButton isCreating={isCreating} />
              <Button
                type="button"
                variant="elevated"
                className="w-full justify-center"
                onClick={() => setCreateOpen(false)}
              >
                <ButtonText>Cancel</ButtonText>
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
    </>
  );
}
