import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import useSWR from "swr";
import Check from "lucide-react/dist/esm/icons/check";
import Copy from "lucide-react/dist/esm/icons/copy";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import { fetcher, apiFetch } from "@/lib/fetcher";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { serializedPatch } from "@/lib/serialized-mutate";
import { BackButton } from "@/components/ui/primitives/back-button";
import { Button, ButtonIcon, ButtonText } from "@/components/ui/primitives/button";
import { Input } from "@/components/ui/primitives/input";
import { Text } from "@/components/ui/primitives/text";
import { PremiumFeatureGate } from "@/components/ui/primitives/upgrade-hint";
import { DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { DeleteConfirmation } from "@/components/ui/primitives/delete-confirmation";
import { ErrorState } from "@/components/ui/primitives/error-state";
import { ProviderIcon } from "@/components/ui/primitives/provider-icon";
import {
  NavigationMenu,
  NavigationMenuCheckboxItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuToggleItem,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { useEntitlements, useMutateEntitlements } from "@/hooks/use-entitlements";
import {
  deleteIcalFeed,
  setFeedCalendars,
  useFeedCalendars,
  useIcalFeed,
} from "@/hooks/use-ical-feeds";
import type { IcalFeed } from "@/hooks/use-ical-feeds";
import { groupCalendarsByAccount, resolveFeedDisclosure } from "@/utils/ical-feeds";
import { resolveErrorMessage } from "@/utils/errors";
import { useCopiedState } from "@/hooks/use-copied-state";
import { icalFeedNameSchema } from "@keeper.sh/data-schemas";
import type { CalendarSource } from "@/types/api";

export const Route = createFileRoute("/(dashboard)/dashboard/ical/$feedId")({
  component: ICalFeedDetailPage,
});

const SETTING_TOGGLES = [
  { field: "includeEventName", label: "Include Event Name" },
  { field: "includeEventDescription", label: "Include Event Description" },
  { field: "includeEventLocation", label: "Include Event Location" },
  { field: "excludeAllDayEvents", label: "Exclude All Day Events" },
] as const;

const FILTER_TOGGLES = [
  { field: "excludeFocusTime", label: "Exclude Focus Time" },
  { field: "excludeOutOfOffice", label: "Exclude Out of Office" },
] as const;

type ToggleField = (typeof SETTING_TOGGLES)[number]["field"]
  | (typeof FILTER_TOGGLES)[number]["field"];

function CopyLinkIcon({ copied }: { copied: boolean }) {
  if (copied) {
    return <Check size={16} />;
  }
  return <Copy size={16} />;
}

function FeedLink({ url, caption }: { url: string; caption: string }) {
  const { copied, markCopied } = useCopiedState();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(url);
    track(ANALYTICS_EVENTS.ical_link_copied);
    markCopied();
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        <Input readOnly value={url} className="text-sm" />
        <Button variant="border" className="shrink-0 aspect-square" onClick={handleCopy}>
          <ButtonIcon>
            <CopyLinkIcon copied={copied} />
          </ButtonIcon>
        </Button>
      </div>
      <Text size="sm" tone="muted">{caption}</Text>
    </div>
  );
}

function FeedLinkSection({ feed }: { feed: IcalFeed }) {
  return (
    <div className="flex flex-col gap-2">
      <DashboardSection
        title="Feed Link"
        description="Subscribe to this link in any calendar app."
      />
      <FeedLink url={feed.icalUrl} caption={resolveFeedDisclosure(feed)} />
      {feed.legacyIcalUrl && (
        <FeedLink
          url={feed.legacyIcalUrl}
          caption="Your original link keeps working, so anything already subscribed to it stays up to date."
        />
      )}
    </div>
  );
}

function CalendarSelectionSection({
  feedId,
  isDefault,
  selected,
  onToggle,
}: {
  feedId: string;
  isDefault: boolean;
  selected: Set<string>;
  onToggle: (calendarId: string, checked: boolean) => void;
}) {
  const { data: sources } = useSWR<CalendarSource[]>("/api/sources", fetcher);
  const groups = useMemo(() => groupCalendarsByAccount(sources ?? []), [sources]);

  if (groups.length === 0) {
    return (
      <DashboardSection
        title="Calendars"
        description={sources
          ? "No calendar sources to include. Import calendars first."
          : "Loading calendars..."}
      />
    );
  }

  const total = groups.reduce((count, group) => count + group.calendars.length, 0);

  return (
    <div className="flex flex-col gap-2">
      <DashboardSection
        title="Calendars"
        description={`${selected.size} of ${total} calendars in this feed.`}
      />
      {isDefault && (
        <Text size="sm" tone="muted">
          Newly connected calendars are added to this feed automatically.
        </Text>
      )}
      {groups.map((group) => (
        <div key={group.accountId} className="flex flex-col gap-1.5">
          <Text size="sm" tone="muted" className="px-0.5">{group.label}</Text>
          <NavigationMenu>
            {group.calendars.map((calendar) => (
              <NavigationMenuCheckboxItem
                key={`${feedId}:${calendar.id}`}
                checked={selected.has(calendar.id)}
                onCheckedChange={(checked) => onToggle(calendar.id, checked)}
              >
                <NavigationMenuItemIcon>
                  <ProviderIcon
                    provider={calendar.provider}
                    calendarType={calendar.calendarType}
                  />
                </NavigationMenuItemIcon>
                <NavigationMenuItemLabel>{calendar.name}</NavigationMenuItemLabel>
              </NavigationMenuCheckboxItem>
            ))}
          </NavigationMenu>
        </div>
      ))}
    </div>
  );
}

function ICalFeedDetailPage() {
  const { feedId } = Route.useParams();
  const navigate = useNavigate();
  const { data: entitlements } = useEntitlements();
  const { revalidateEntitlements } = useMutateEntitlements();
  const { data: feed, error, mutate } = useIcalFeed(feedId);
  const { data: calendars, mutate: mutateCalendars } = useFeedCalendars(feedId);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const locked = entitlements ? !entitlements.canCustomizeIcalFeed : false;
  const selected = useMemo(
    () => new Set(calendars?.calendarIds ?? []),
    [calendars?.calendarIds],
  );

  if (error) {
    return (
      <div className="flex flex-col gap-1.5">
        <BackButton fallback="/dashboard/ical" />
        <ErrorState message="Failed to load this iCal feed." onRetry={() => mutate()} />
      </div>
    );
  }

  if (!feed) {
    return (
      <div className="flex flex-col gap-1.5">
        <BackButton fallback="/dashboard/ical" />
      </div>
    );
  }

  const patchFeed = (patch: Record<string, unknown>) => {
    const swrKey = `/api/ical/feeds/${feedId}`;
    mutate({ ...feed, ...patch } as IcalFeed, { revalidate: false });
    serializedPatch(
      swrKey,
      patch,
      (mergedPatch) => apiFetch(swrKey, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mergedPatch),
      }),
      (patchError) => {
        setMutationError(resolveErrorMessage(patchError, "Failed to update this feed."));
        mutate();
      },
    );
  };

  const handleToggleSetting = (field: ToggleField) => {
    if (locked) return;
    const nextValue = !feed[field];
    track(ANALYTICS_EVENTS.ical_setting_toggled, { field, enabled: nextValue });
    patchFeed({ [field]: nextValue });
  };

  const handleToggleCalendar = async (calendarId: string, checked: boolean) => {
    const nextIds = checked
      ? [...selected, calendarId]
      : [...selected].filter((id) => id !== calendarId);

    track(ANALYTICS_EVENTS.ical_source_toggled, { enabled: checked, feedId });
    setMutationError(null);
    try {
      await mutateCalendars(
        async () => {
          await setFeedCalendars(feedId, nextIds);
          return { calendarIds: nextIds };
        },
        {
          optimisticData: { calendarIds: nextIds },
          rollbackOnError: true,
          revalidate: false,
        },
      );
      await mutate();
    } catch (err) {
      setMutationError(resolveErrorMessage(err, "Failed to update this feed's calendars."));
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setMutationError(null);
    try {
      await deleteIcalFeed(feedId);
      track(ANALYTICS_EVENTS.ical_feed_deleted);
      await revalidateEntitlements();
      await navigate({ to: "/dashboard/ical" });
    } catch (err) {
      setMutationError(resolveErrorMessage(err, "Failed to delete this feed."));
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <BackButton fallback="/dashboard/ical" />
      {mutationError && <Text size="sm" tone="danger">{mutationError}</Text>}
      <FeedLinkSection feed={feed} />
      <FeedNameSection
        name={feed.name}
        onRename={(name) => patchFeed({ name })}
      />
      <CalendarSelectionSection
        feedId={feedId}
        isDefault={feed.isDefault}
        selected={selected}
        onToggle={handleToggleCalendar}
      />
      <DashboardSection
        title="Feed Settings"
        description="Choose which event details this link includes."
      />
      <PremiumFeatureGate locked={locked} hint="Feed settings are Pro-only.">
        <NavigationMenu>
          {SETTING_TOGGLES.map(({ field, label }) => (
            <NavigationMenuToggleItem
              key={field}
              checked={feed[field]}
              disabled={locked}
              onCheckedChange={() => handleToggleSetting(field)}
            >
              <NavigationMenuItemLabel>{label}</NavigationMenuItemLabel>
            </NavigationMenuToggleItem>
          ))}
        </NavigationMenu>
      </PremiumFeatureGate>
      <DashboardSection
        title="Event Filters"
        description="Leave these event types out of this link."
      />
      <PremiumFeatureGate locked={locked} hint="Event filters are Pro-only.">
        <NavigationMenu>
          {FILTER_TOGGLES.map(({ field, label }) => (
            <NavigationMenuToggleItem
              key={field}
              checked={feed[field]}
              disabled={locked}
              onCheckedChange={() => handleToggleSetting(field)}
            >
              <NavigationMenuItemLabel>{label}</NavigationMenuItemLabel>
            </NavigationMenuToggleItem>
          ))}
        </NavigationMenu>
      </PremiumFeatureGate>
      {!feed.isDefault && (
        <>
          <Button
            variant="destructive"
            className="w-full justify-center"
            onClick={() => setDeleteOpen(true)}
          >
            <ButtonIcon>
              <Trash2 size={16} />
            </ButtonIcon>
            <ButtonText>Delete Feed</ButtonText>
          </Button>
          <DeleteConfirmation
            title="Delete feed?"
            description={`This permanently removes "${feed.name}". Calendar apps subscribed to its link will stop receiving events.`}
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            deleting={deleting}
            onConfirm={handleDelete}
          />
        </>
      )}
    </div>
  );
}

function FeedNameSection({
  name,
  onRename,
}: {
  name: string;
  onRename: (name: string) => void;
}) {
  const [draft, setDraft] = useState(name);

  const handleCommit = () => {
    const trimmed = draft.trim();
    if (!icalFeedNameSchema.allows(trimmed) || trimmed === name) {
      setDraft(name);
      return;
    }
    onRename(trimmed);
  };

  return (
    <div className="flex flex-col gap-2">
      <DashboardSection title="Name" description="Only you can see this name." />
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={handleCommit}
        placeholder="Feed name"
        className="text-sm"
      />
    </div>
  );
}
