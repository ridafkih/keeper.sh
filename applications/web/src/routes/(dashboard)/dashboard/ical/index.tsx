import { useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { preload } from "swr";
import Link2 from "lucide-react/dist/esm/icons/link-2";
import Plus from "lucide-react/dist/esm/icons/plus";
import { Button, ButtonText } from "@/components/ui/primitives/button";
import { BackButton } from "@/components/ui/primitives/back-button";
import { Input } from "@/components/ui/primitives/input";
import { DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { RouteShell } from "@/components/ui/shells/route-shell";
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
  NavigationMenuLinkItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { createIcalFeed, useIcalFeeds } from "@/hooks/use-ical-feeds";
import { useEntitlements, useMutateEntitlements } from "@/hooks/use-entitlements";
import { canCreateFeed } from "@/utils/ical-feeds";
import { fetcher } from "@/lib/fetcher";
import { pluralize } from "@/lib/pluralize";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { resolveErrorMessage } from "@/utils/errors";

export const Route = createFileRoute("/(dashboard)/dashboard/ical/")({
  component: ICalFeedsPage,
});

function ICalFeedsPage() {
  const { data: entitlements } = useEntitlements();
  const { revalidateEntitlements } = useMutateEntitlements();
  const { data: feeds, isLoading, error, mutate } = useIcalFeeds();
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  if (error || isLoading || !feeds) {
    if (error) return <RouteShell status="error" onRetry={() => { void mutate(); }} />;
    return <RouteShell status="loading" />;
  }

  const canCreate = canCreateFeed(entitlements);

  return (
    <div className="flex flex-col gap-1.5">
      <BackButton />
      <DashboardSection
        title="iCal Feeds"
        description="Each feed is a link you can subscribe to in any calendar app, with its own calendars and privacy settings."
      />
      {mutationError && <Text size="sm" tone="danger">{mutationError}</Text>}
      <NavigationMenu>
        {feeds.map((feed) => (
          <NavigationMenuLinkItem
            key={feed.id}
            to={`/dashboard/ical/${feed.id}`}
            onMouseEnter={() => {
              preload(`/api/ical/feeds/${feed.id}`, fetcher);
              preload(`/api/ical/feeds/${feed.id}/calendars`, fetcher);
            }}
          >
            <NavigationMenuItemIcon>
              <Link2 size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>{feed.name}</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing>
              <Text size="sm" tone="muted">
                {pluralize(feed.calendarCount ?? 0, "calendar")}
              </Text>
            </NavigationMenuItemTrailing>
          </NavigationMenuLinkItem>
        ))}
        <CreateFeedItem
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
      {!canCreate && <UpgradeHint>Free plans include one iCal feed.</UpgradeHint>}
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

function CreateFeedItem({
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
              Give your feed a name to help you remember what it is for.
            </ModalDescription>
            <Input ref={nameRef} name="name" placeholder="Feed name" autoFocus />
            <ModalFooter>
              <CreateSubmitButton isCreating={isCreating} />
              <Button
                type="button"
                variant="border"
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
