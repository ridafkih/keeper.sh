import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import useSWR, { preload } from "swr";
import Check from "lucide-react/dist/esm/icons/check";
import Copy from "lucide-react/dist/esm/icons/copy";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import { icalFeedNameSchema } from "@keeper.sh/data-schemas";
import { apiFetch, fetcher } from "@/lib/fetcher";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { serializedPatch } from "@/lib/serialized-mutate";
import { formatDate } from "@/lib/time";
import { BackButton } from "@/components/ui/primitives/back-button";
import { PageBody } from "@/components/ui/primitives/page-body";
import { StickyPageHeader } from "@/components/ui/primitives/sticky-page-header";
import { Button, ButtonIcon } from "@/components/ui/primitives/button";
import { Input } from "@/components/ui/primitives/input";
import { DashboardHeading1, DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { DeleteConfirmation } from "@/components/ui/primitives/delete-confirmation";
import { Pagination, PaginationPrevious, PaginationNext } from "@/components/ui/primitives/pagination";
import { ProviderIcon } from "@/components/ui/primitives/provider-icon";
import { RouteShell } from "@/components/ui/shells/route-shell";
import { TemplateText } from "@/components/ui/primitives/template-text";
import { Text } from "@/components/ui/primitives/text";
import { PremiumFeatureGate } from "@/components/ui/primitives/upgrade-hint";
import {
  NavigationMenu,
  NavigationMenuButtonItem,
  NavigationMenuCheckboxItem,
  NavigationMenuEmptyItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
  NavigationMenuToggleItem,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import {
  NavigationMenuEditableItem,
  NavigationMenuEditableTemplateItem,
} from "@/components/ui/composites/navigation-menu/navigation-menu-editable";
import { MetadataRow } from "@/features/dashboard/components/metadata-row";
import { useCopiedState } from "@/hooks/use-copied-state";
import { useEntitlements, useMutateEntitlements } from "@/hooks/use-entitlements";
import {
  deleteIcalFeed,
  setFeedCalendars,
  useFeedCalendars,
  useIcalFeed,
  useIcalFeeds,
} from "@/hooks/use-ical-feeds";
import type { IcalFeed } from "@/hooks/use-ical-feeds";
import {
  resolveCalendarSelection,
  resolveEventNamePatch,
  resolveFeedDisclosure,
  resolveFeedNeighbours,
  resolvePickableCalendars,
} from "@/utils/ical-feeds";
import { resolveErrorMessage } from "@/utils/errors";
import type { CalendarSource } from "@/types/api";

export const Route = createFileRoute("/(dashboard)/dashboard/ical/$feedId")({
  component: ICalFeedDetailPage,
});

const SETTING_TOGGLES = [
  { field: "includeEventDescription", label: "Include Event Description" },
  { field: "includeEventLocation", label: "Include Event Location" },
  { field: "excludeAllDayEvents", label: "Exclude All Day Events" },
] as const;

const FILTER_TOGGLES = [
  { field: "excludeFocusTime", label: "Exclude Focus Time" },
  { field: "excludeOutOfOffice", label: "Exclude Out of Office" },
] as const;

type ToggleField =
  | (typeof SETTING_TOGGLES)[number]["field"]
  | (typeof FILTER_TOGGLES)[number]["field"];

const TEMPLATE_VARIABLES = { calendar_name: "Calendar Name", event_name: "Event Name" };

function ICalFeedDetailPage() {
  const { feedId } = Route.useParams();
  const navigate = useNavigate();
  const { revalidateEntitlements } = useMutateEntitlements();
  const { data: entitlements } = useEntitlements();
  const { data: feed, isLoading: feedLoading, error, mutate } = useIcalFeed(feedId);
  const {
    data: calendarSelection,
    isLoading: calendarsLoading,
    mutate: mutateCalendars,
  } = useFeedCalendars(feedId);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const locked = entitlements ? !entitlements.canCustomizeIcalFeed : false;
  const selected = useMemo(
    () => new Set(calendarSelection?.calendarIds ?? []),
    [calendarSelection?.calendarIds],
  );

  const isLoading = feedLoading || calendarsLoading;

  if (error || isLoading || !feed) {
    if (error) {
      return (
        <RouteShell
          backFallback="/dashboard/ical"
          status="error"
          onRetry={() => { void mutate(); }}
        />
      );
    }
    return <RouteShell backFallback="/dashboard/ical" status="loading" />;
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
        void mutate();
      },
    );
  };

  const handleRename = (name: string) => {
    if (!icalFeedNameSchema.allows(name)) {
      setMutationError("Feed name cannot be empty.");
      return;
    }
    setMutationError(null);
    patchFeed({ name });
  };

  const handleToggleSetting = (field: ToggleField) => {
    if (locked) return;
    const enabled = !feed[field];
    track(ANALYTICS_EVENTS.ical_setting_toggled, { field, enabled });
    patchFeed({ [field]: enabled });
  };

  const handleToggleEventName = () => {
    if (locked) return;
    const patch = resolveEventNamePatch(!feed.includeEventName);
    track(ANALYTICS_EVENTS.ical_setting_toggled, {
      field: "includeEventName",
      enabled: patch.includeEventName,
    });
    patchFeed(patch);
  };

  const handleToggleCalendar = async (calendarId: string, checked: boolean) => {
    const calendarIds = resolveCalendarSelection(selected, calendarId, checked);

    track(ANALYTICS_EVENTS.ical_source_toggled, { enabled: checked, feedId });
    setMutationError(null);
    try {
      await mutateCalendars(
        async () => {
          await setFeedCalendars(feedId, calendarIds);
          return { calendarIds };
        },
        {
          optimisticData: { calendarIds },
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
    <div className="flex flex-col gap-1.5 lg:h-full">
      <StickyPageHeader className="gap-1.5">
        <div className="flex items-center justify-between">
          <BackButton fallback="/dashboard/ical" />
          <FeedPrevNext feedId={feedId} />
        </div>
        <FeedHeader name={feed.name} />
      </StickyPageHeader>
      <PageBody className="gap-1.5">
        {mutationError && <Text size="sm" tone="danger">{mutationError}</Text>}
        <DashboardSection
          title="Feed Link"
          description="Subscribe to this link in any calendar app."
        />
        <FeedLinkField url={feed.icalUrl} onError={setMutationError} />
        <Text size="sm" tone="muted" className="px-0.5">{resolveFeedDisclosure(feed)}</Text>
        <DashboardSection
          title="Feed Name"
          description="Click below to rename this feed. Only you can see this name."
        />
        <NavigationMenu>
          <NavigationMenuEditableItem value={feed.name} onCommit={handleRename} />
        </NavigationMenu>
        <CalendarsSection
          isDefault={feed.isDefault}
          selected={selected}
          onToggle={handleToggleCalendar}
        />
        <DashboardSection
          title="Feed Settings"
          description={<>Choose which event details this link includes. Use <Text as="span" size="sm" className="text-template inline">{"{{calendar_name}}"}</Text> or <Text as="span" size="sm" className="text-template inline">{"{{event_name}}"}</Text> in text fields for dynamic values.</>}
        />
        <PremiumFeatureGate locked={locked} hint="Feed settings are a Pro feature.">
          <NavigationMenu>
            <EventNameTemplateItem
              customEventName={feed.customEventName}
              disabled={locked || feed.includeEventName}
              onCommit={(customEventName) => patchFeed({ customEventName })}
            />
            <NavigationMenuToggleItem
              checked={feed.includeEventName}
              disabled={locked}
              onCheckedChange={handleToggleEventName}
            >
              <NavigationMenuItemLabel>Include Event Name</NavigationMenuItemLabel>
            </NavigationMenuToggleItem>
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
        <PremiumFeatureGate locked={locked} hint="Event filters are a Pro feature.">
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
        <DashboardSection
          title="Feed Information"
          description="View details about this feed."
        />
        <NavigationMenu>
          <MetadataRow label="Resource Type" value={feed.isDefault ? "Default Feed" : "Feed"} />
          <MetadataRow label="Created" value={formatDate(feed.createdAt)} />
        </NavigationMenu>
        {feed.isDefault && (
          <Text size="sm" tone="muted" className="px-0.5">
            Your default feed cannot be deleted. Create another feed to share a narrower set of
            calendars.
          </Text>
        )}
        {!feed.isDefault && (
          <>
            <NavigationMenu>
              <NavigationMenuButtonItem onClick={() => setDeleteOpen(true)}>
                <NavigationMenuItemIcon>
                  <Trash2 size={15} className="text-destructive" />
                </NavigationMenuItemIcon>
                <Text size="sm" tone="danger">Delete Feed</Text>
              </NavigationMenuButtonItem>
            </NavigationMenu>
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
      </PageBody>
    </div>
  );
}

function FeedHeader({ name }: { name: string }) {
  return (
    <div className="flex flex-col px-0.5 pt-4">
      <DashboardHeading1 className="select-none">{name}</DashboardHeading1>
    </div>
  );
}

function FeedLinkField({
  url,
  onError,
}: {
  url: string;
  onError: (message: string) => void;
}) {
  const { copied, markCopied } = useCopiedState();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      onError("Failed to copy this feed's link. Select it above to copy it manually.");
      return;
    }
    track(ANALYTICS_EVENTS.ical_link_copied);
    markCopied();
  };

  return (
    <div className="flex gap-1.5">
      <Input readOnly value={url} className="text-sm" />
      <Button
        variant="border"
        className="shrink-0 aspect-square"
        onClick={() => { void handleCopy(); }}
        aria-label="Copy feed link"
      >
        <ButtonIcon>
          <CopyStateIcon copied={copied} />
        </ButtonIcon>
      </Button>
    </div>
  );
}

function CopyStateIcon({ copied }: { copied: boolean }) {
  if (copied) {
    return <Check size={16} />;
  }
  return <Copy size={16} />;
}

function EventNameTemplateItem({
  customEventName,
  disabled,
  onCommit,
}: {
  customEventName: string;
  disabled: boolean;
  onCommit: (customEventName: string) => void;
}) {
  const template = customEventName || "Busy";

  return (
    <NavigationMenuEditableTemplateItem
      label="Event Name"
      disabled={disabled}
      value={template}
      renderInput={(live) => <TemplateText template={live} variables={TEMPLATE_VARIABLES} />}
      onCommit={onCommit}
    >
      <Text
        size="sm"
        tone={disabled ? "disabled" : "muted"}
        className="min-w-0 truncate flex-1 text-right"
      >
        <TemplateText template={template} variables={TEMPLATE_VARIABLES} disabled={disabled} />
      </Text>
    </NavigationMenuEditableTemplateItem>
  );
}

function resolveCalendarsDescription(isDefault: boolean): string {
  if (isDefault) {
    return "Select which calendars contribute events to this feed. Calendars you import later join this feed automatically.";
  }
  return "Select which calendars contribute events to this feed.";
}

function CalendarsSection({
  isDefault,
  selected,
  onToggle,
}: {
  isDefault: boolean;
  selected: Set<string>;
  onToggle: (calendarId: string, checked: boolean) => void;
}) {
  const { data: sources } = useSWR<CalendarSource[]>("/api/sources");
  const calendars = useMemo(() => resolvePickableCalendars(sources ?? []), [sources]);

  return (
    <>
      <DashboardSection title="Calendars" description={resolveCalendarsDescription(isDefault)} />
      <NavigationMenu>
        {calendars.length === 0 ? (
          <NavigationMenuEmptyItem>No calendars available</NavigationMenuEmptyItem>
        ) : (
          calendars.map((calendar) => (
            <NavigationMenuCheckboxItem
              key={calendar.id}
              checked={selected.has(calendar.id)}
              onCheckedChange={(checked) => onToggle(calendar.id, checked)}
            >
              <NavigationMenuItemIcon>
                <ProviderIcon
                  provider={calendar.provider}
                  calendarType={calendar.calendarType}
                />
              </NavigationMenuItemIcon>
              <NavigationMenuItemLabel className="shrink-0">{calendar.name}</NavigationMenuItemLabel>
              <NavigationMenuItemTrailing className="overflow-hidden">
                <Text size="sm" tone="muted" align="right" className="flex-1 min-w-0 truncate">
                  {calendar.accountLabel}
                </Text>
              </NavigationMenuItemTrailing>
            </NavigationMenuCheckboxItem>
          ))
        )}
      </NavigationMenu>
    </>
  );
}

function FeedPrevNext({ feedId }: { feedId: string }) {
  const { data: feeds } = useIcalFeeds();
  const { previous, next } = resolveFeedNeighbours(feeds ?? [], feedId);

  useEffect(() => {
    if (previous) preload(`/api/ical/feeds/${previous.id}`, fetcher);
    if (next) preload(`/api/ical/feeds/${next.id}`, fetcher);
  }, [previous, next]);

  if (!feeds || feeds.length <= 1) return null;

  return (
    <Pagination>
      <PaginationPrevious to={previous ? `/dashboard/ical/${previous.id}` : undefined} />
      <PaginationNext to={next ? `/dashboard/ical/${next.id}` : undefined} />
    </Pagination>
  );
}
