import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import useSWR from "swr";
import Pause from "lucide-react/dist/esm/icons/pause";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import { syncNameSchema } from "@keeper.sh/data-schemas";
import type { PatchSyncBody, SyncDefinition, SyncDetail } from "@keeper.sh/data-schemas";
import { BackButton } from "@/components/ui/primitives/back-button";
import { DashboardHeading1, DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { DeleteConfirmation } from "@/components/ui/primitives/delete-confirmation";
import { MenuHint } from "@/components/ui/primitives/menu-hint";
import { PageBody } from "@/components/ui/primitives/page-body";
import { SegmentedControl } from "@/components/ui/primitives/segmented-control";
import { StickyPageHeader } from "@/components/ui/primitives/sticky-page-header";
import { Text } from "@/components/ui/primitives/text";
import { ProviderIcon } from "@/components/ui/primitives/provider-icon";
import { RouteShell } from "@/components/ui/shells/route-shell";
import {
  NavigationMenu,
  NavigationMenuButtonItem,
  NavigationMenuEmptyItem,
  NavigationMenuItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
  NavigationMenuToggleItem,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { NavigationMenuEditableItem } from "@/components/ui/composites/navigation-menu/navigation-menu-editable";
import { useEntitlements } from "@/hooks/use-entitlements";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import type { CalendarSource } from "@/types/api";
import { ActivityList } from "@/features/syncs/components/activity-list";
import { SyncEditor } from "@/features/syncs/components/sync-editor";
import { SyncPreviewPanel } from "@/features/syncs/components/sync-preview-panel";
import { SyncStatusDot } from "@/features/syncs/components/sync-status-dot";
import { formatSyncedAgo } from "@/features/syncs/relative-time";
import { resolveSyncError } from "@/features/syncs/sync-errors";
import { STATE_LABELS, previewCalendarNames, syncSettingsOf, type CalendarsById } from "@/features/syncs/syncs";
import { deleteSync, patchSync, useRefreshSyncs, useSync, useSyncActivity, useSyncs } from "@/features/syncs/use-syncs";

type SyncTab = "setup" | "activity";

export const Route = createFileRoute("/(dashboard)/dashboard/syncs/$syncId")({
  component: SyncPage,
  validateSearch: (search: Record<string, unknown>): { tab?: SyncTab } => ({
    tab: search.tab === "activity" ? "activity" : undefined,
  }),
});

const PATCH_KEYS = [
  "busyTitle", "destinationCalendarIds", "markPrivate", "memberCalendarIds", "mode", "name", "paused",
  "rules", "shareAs", "skipAllDay", "skipFocusTime", "skipOutOfOffice", "skipTitleKeywords", "sourceCalendarIds",
] as const satisfies readonly (keyof PatchSyncBody)[];

const toPatchBody = (patch: Partial<SyncDefinition>): PatchSyncBody =>
  Object.fromEntries(PATCH_KEYS.filter((key) => key in patch).map((key) => [key, patch[key]])) as PatchSyncBody;

function SyncPage() {
  const { syncId } = Route.useParams();
  const { tab = "setup" } = Route.useSearch();
  const navigate = useNavigate();
  const { data: sync, error, mutate } = useSync(syncId);
  const { data: syncs } = useSyncs();
  const { data: calendars } = useSWR<CalendarSource[]>("/api/sources");
  const { data: entitlements } = useEntitlements();
  const refresh = useRefreshSyncs();
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (error) return <RouteShell backFallback="/dashboard/syncs" status="error" onRetry={() => { void mutate(); }} />;
  if (!sync || !calendars) return <RouteShell backFallback="/dashboard/syncs" status="loading" />;

  const calendarsById: CalendarsById = new Map(calendars.map((calendar) => [calendar.id, calendar] as const));
  const locked = Boolean(entitlements && !entitlements.canUseEventFilters);

  const change = (patch: Partial<SyncDefinition>) => {
    const body = toPatchBody(patch);
    if (Object.keys(body).length === 0) return;
    track(ANALYTICS_EVENTS.sync_updated, { field: Object.keys(body).join(",") });
    setMutationError(null);
    void mutate({ ...sync, ...patch }, { revalidate: false });
    patchSync(
      syncId,
      body,
      (patchError) => {
        setMutationError(resolveSyncError(patchError, "Failed to update this sync.", calendarsById));
        void mutate();
      },
      () => { void refresh(syncId); },
    );
  };

  const setPaused = (paused: boolean) => {
    track(paused ? ANALYTICS_EVENTS.sync_paused : ANALYTICS_EVENTS.sync_resumed);
    change({ paused });
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteSync(syncId);
      track(ANALYTICS_EVENTS.sync_deleted);
      await refresh();
      await navigate({ to: "/dashboard" });
    } catch (deleteError) {
      setMutationError(resolveSyncError(deleteError, "Failed to delete this sync.", calendarsById));
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  const previewNames = previewCalendarNames(sync, calendarsById);

  return (
    <div className="@container flex flex-col gap-1.5 lg:h-full">
      <StickyPageHeader className="gap-1.5">
        <div className="lg:hidden">
          <BackButton fallback="/dashboard/syncs" />
        </div>
        <div className="flex flex-col gap-1 px-0.5 pt-4">
          <DashboardHeading1 className="select-none">{sync.name}</DashboardHeading1>
          <Text size="sm" tone="muted" className="flex items-center gap-2">
            <SyncStatusDot state={sync.state} />
            {statusLine(sync)}
          </Text>
        </div>
        <div className="px-0.5 pt-2">
          <SegmentedControl
            label="Sync sections"
            value={tab}
            options={[{ label: "Setup", value: "setup" }, { label: "Activity", value: "activity" }]}
            onChange={(next) => {
              if (next === "activity") track(ANALYTICS_EVENTS.sync_activity_viewed);
              void navigate({ replace: true, search: { tab: next === "activity" ? "activity" : undefined }, to: "." });
            }}
          />
        </div>
      </StickyPageHeader>
      <PageBody className="gap-1.5">
        {mutationError && <Text size="sm" tone="danger" className="px-0.5">{mutationError}</Text>}
        {tab === "setup" ? (
          <div className="grid grid-cols-1 gap-8 @3xl:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
            <div className="flex min-w-0 flex-col gap-1.5">
              <NavigationMenu>
                <NavigationMenuEditableItem
                  label="Name"
                  value={sync.name}
                  onCommit={(name) => {
                    if (syncNameSchema.allows(name)) change({ name });
                    else setMutationError("Sync name can't be empty.");
                  }}
                />
                <NavigationMenuToggleItem checked={sync.paused} onCheckedChange={setPaused}>
                  <NavigationMenuItemIcon>
                    <Pause size={15} />
                  </NavigationMenuItemIcon>
                  <NavigationMenuItemLabel>Pause This Sync</NavigationMenuItemLabel>
                </NavigationMenuToggleItem>
              </NavigationMenu>
              {sync.paused && <MenuHint tone="attention">Paused. Copies stay as they are, and new events wait until you resume.</MenuHint>}
              <SyncEditor
                value={sync}
                calendars={calendars}
                otherSyncs={(syncs ?? []).filter((other) => other.id !== sync.id)}
                locked={locked}
                previewClassName="@3xl:hidden"
                onChange={change}
              />
              <div className="pt-3">
                <NavigationMenu>
                  <NavigationMenuButtonItem onClick={() => setDeleteOpen(true)}>
                    <NavigationMenuItemIcon>
                      <Trash2 size={15} className="text-destructive" />
                    </NavigationMenuItemIcon>
                    <Text size="sm" tone="danger">Delete Sync</Text>
                  </NavigationMenuButtonItem>
                </NavigationMenu>
              </div>
              <DeleteConfirmation
                title="Delete this sync?"
                description={`Its copies are removed from ${destinationNames(sync, calendarsById) || "its destinations"}. The original events aren't touched.`}
                open={deleteOpen}
                onOpenChange={setDeleteOpen}
                deleting={deleting}
                onConfirm={() => void handleDelete()}
              />
            </div>
            <aside className="hidden @3xl:block">
              <div className="sticky top-4">
                <SyncPreviewPanel
                  settings={syncSettingsOf(sync)}
                  sourceName={previewNames.source}
                  destinationName={previewNames.destination}
                />
              </div>
            </aside>
          </div>
        ) : (
          <SyncActivity sync={sync} calendars={calendars} calendarsById={calendarsById} />
        )}
      </PageBody>
    </div>
  );
}

const statusLine = (sync: SyncDetail): string => {
  if (sync.state !== "ok") return STATE_LABELS[sync.state];
  if (!sync.lastSyncedAt) return "Waiting for the first sync";
  const copies = sync.copiedCount === 1 ? "1 copy" : `${sync.copiedCount} copies`;
  return `${STATE_LABELS.ok} · synced ${formatSyncedAgo(sync.lastSyncedAt).toLowerCase()} · ${copies}`;
};

const destinationNames = (sync: SyncDetail, calendarsById: CalendarsById): string =>
  sync.destinations.map((destination) => calendarsById.get(destination.calendarId)?.name).filter(Boolean).join(", ");

const PROBLEM_LABELS = { disabled: "Disabled", failing: "Retrying", reauth: "Needs reconnecting" } as const;

function SyncActivity({ sync, calendars, calendarsById }: { sync: SyncDetail; calendars: CalendarSource[]; calendarsById: CalendarsById }) {
  const { entries, hasMore, isValidating, setSize, size } = useSyncActivity(sync.id);
  const problems = sync.destinations.filter((destination) => destination.problem !== null).length;
  const metrics = [
    { label: "Copied", value: sync.copiedCount },
    { label: "Skipped", value: sync.skippedCount },
    { label: "Problems", value: problems },
  ];

  return (
    <>
      <div className="grid grid-cols-3 gap-1.5 pt-2">
        {metrics.map((metric) => (
          <div key={metric.label} className="flex flex-col rounded-2xl border border-interactive-border bg-background px-3.5 py-3 shadow-xs">
            <Text size="xs" tone="muted">{metric.label}</Text>
            <span className="text-xl font-medium tracking-tight tabular-nums text-foreground">{metric.value}</span>
          </div>
        ))}
      </div>
      <DashboardSection title="Destinations" description="Where this sync writes, and how each one is doing." />
      <NavigationMenu>
        {sync.destinations.length === 0 && <NavigationMenuEmptyItem>No destinations yet</NavigationMenuEmptyItem>}
        {sync.destinations.map((destination) => {
          const calendar = calendars.find((candidate) => candidate.id === destination.calendarId);
          return (
            <NavigationMenuItem key={destination.calendarId}>
              {calendar && (
                <NavigationMenuItemIcon>
                  <ProviderIcon provider={calendar.provider} calendarType={calendar.calendarType} />
                </NavigationMenuItemIcon>
              )}
              <NavigationMenuItemLabel>{calendar?.name ?? "Removed calendar"}</NavigationMenuItemLabel>
              <NavigationMenuItemTrailing>
                <Text size="sm" tone={destination.problem ? "attention" : "muted"}>
                  {destination.problem
                    ? PROBLEM_LABELS[destination.problem]
                    : `${destination.copiedCount} copies · ${formatSyncedAgo(destination.lastSyncedAt).toLowerCase()}`}
                </Text>
              </NavigationMenuItemTrailing>
            </NavigationMenuItem>
          );
        })}
      </NavigationMenu>
      <DashboardSection title="Activity" description="Sync runs and the changes you make, newest first." />
      <ActivityList
        entries={entries}
        calendarsById={calendarsById}
        hasMore={hasMore}
        loadingMore={isValidating && size > 1}
        onLoadMore={() => { void setSize(size + 1); }}
      />
    </>
  );
}
