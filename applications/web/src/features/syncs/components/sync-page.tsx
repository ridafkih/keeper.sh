import { useEffect, useState } from "react";
import { useBlocker, useNavigate, useSearch } from "@tanstack/react-router";
import useSWR from "swr";
import Pause from "lucide-react/dist/esm/icons/pause";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import { addsProSettings, diffSyncChanges } from "@keeper.sh/data-schemas";
import type { SyncDefinition, SyncDetail } from "@keeper.sh/data-schemas";
import { BackButton } from "@/components/ui/primitives/back-button";
import { DeleteConfirmation } from "@/components/ui/primitives/delete-confirmation";
import { ErrorState } from "@/components/ui/primitives/error-state";
import { MenuHint } from "@/components/ui/primitives/menu-hint";
import { SegmentedControl } from "@/components/ui/primitives/segmented-control";
import { PageBody } from "@/components/ui/primitives/page-body";
import { Text } from "@/components/ui/primitives/text";
import { RouteShell } from "@/components/ui/shells/route-shell";
import {
  NavigationMenu,
  NavigationMenuButtonItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuToggleItem,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { NavigationMenuEditableItem } from "@/components/ui/composites/navigation-menu/navigation-menu-editable";
import { useEntitlements } from "@/hooks/use-entitlements";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { HttpError } from "@/lib/fetcher";
import type { CalendarSource } from "@/types/api";
import { SyncActivity } from "@/features/syncs/components/sync-activity";
import { SyncEditor } from "@/features/syncs/components/sync-editor";
import { SyncPageHeader } from "@/features/syncs/components/sync-page-header";
import { SyncPreviewPanel } from "@/features/syncs/components/sync-preview-panel";
import { DiscardChangesConfirmation, SaveSyncConfirmation } from "@/features/syncs/components/sync-save-dialogs";
import { SyncStatusDot } from "@/features/syncs/components/sync-status-dot";
import { formatSyncedAgo } from "@/features/syncs/relative-time";
import { SYNC_PANE_COLUMNS, SyncActionBar } from "@/features/syncs/components/sync-action-bar";
import { cn } from "@/utils/cn";
import {
  addCalendarToSync,
  describeRemovals,
  draftProblem,
  pruneStaleEdits,
  saveRemovals,
  settleEdits,
  syncNameProblem,
  toPatchBody,
  type SyncEdits,
} from "@/features/syncs/sync-draft";
import { isStaleSyncError, resolveSyncError } from "@/features/syncs/sync-errors";
import { isSyncLocked, syncCalendarLimit } from "@/features/syncs/sync-plan";
import {
  STATE_LABELS,
  describeChange,
  describeConflicts,
  findDraftConflicts,
  previewDirections,
  syncSettingsOf,
  type CalendarsById,
} from "@/features/syncs/syncs";
import { useTrackConflicts } from "@/features/syncs/use-create-sync";
import { deleteSync, patchSync, saveSync, useRefreshSyncs, useSync, useSyncs } from "@/features/syncs/use-syncs";

export type SyncTab = "setup" | "activity";

const PRO_PROBLEM = "Pro settings need a Pro plan. Take out what you added to save.";

const readAddCalendar = (search: Record<string, unknown>): string | null =>
  typeof search.addCalendar === "string" ? search.addCalendar : null;

export function SyncPage({ syncId, tab }: { syncId: string; tab: SyncTab }) {
  const navigate = useNavigate();
  const addCalendar = readAddCalendar(useSearch({ strict: false }));
  const { data: sync, error, mutate } = useSync(syncId);
  const { data: syncs } = useSyncs();
  const { data: calendars } = useSWR<CalendarSource[]>("/api/sources");
  const { data: entitlements } = useEntitlements();
  const refresh = useRefreshSyncs();
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [rawEdits, setEdits] = useState<SyncEdits>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  // A sync deleted elsewhere leaves nothing to save, so its edits stop holding navigation back.
  const deleted = error instanceof HttpError && error.status === 404;
  const edits = calendars ? pruneStaleEdits(rawEdits, calendars) : rawEdits;
  const draft: SyncDefinition | undefined = sync && { ...sync, ...edits };
  const changes = sync && draft && !deleted ? diffSyncChanges(sync, draft) : [];
  const dirty = changes.length > 0;
  const otherSyncs = (syncs ?? []).filter((other) => other.id !== syncId);
  const conflicts = draft ? findDraftConflicts(draft, otherSyncs) : [];
  useTrackConflicts(conflicts.length > 0);

  // Switching between Setup and Activity only changes the search, so the draft carries across.
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => dirty && next.pathname !== current.pathname,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });

  // A calendar connected for this sync arrives as ?addCalendar; it joins the unsaved draft for the user to review and save.
  useEffect(() => {
    if (!addCalendar || !sync || !calendars) return;
    const calendar = calendars.find((candidate) => candidate.id === addCalendar);
    setEdits((current) => {
      const added = addCalendarToSync({ ...sync, ...current }, calendar);
      return added ? { ...current, ...added } : current;
    });
    void navigate({
      params: { syncId },
      replace: true,
      search: { tab: tab === "activity" ? "activity" : undefined },
      to: "/dashboard/syncs/$syncId",
    });
  }, [addCalendar, sync, calendars, navigate, syncId, tab]);

  const discardDialog = (
    <DiscardChangesConfirmation
      open={blocker.status === "blocked"}
      onKeepEditing={() => blocker.reset?.()}
      onDiscard={() => blocker.proceed?.()}
    />
  );

  if (error && (!sync || deleted)) {
    return (
      <>
        <div className="flex flex-col gap-1.5">
          <BackButton fallback="/dashboard/syncs" />
          <ErrorState
            message={deleted ? "This sync no longer exists. It may have been deleted somewhere else." : undefined}
            onRetry={() => { void mutate(); }}
          />
        </div>
        {discardDialog}
      </>
    );
  }
  if (!sync || !draft || !calendars) {
    return (
      <>
        <RouteShell backFallback="/dashboard/syncs" status="loading" />
        {discardDialog}
      </>
    );
  }

  const calendarsById: CalendarsById = new Map(calendars.map((calendar) => [calendar.id, calendar] as const));
  const locked = isSyncLocked(entitlements);
  const proProblem = locked && addsProSettings(syncSettingsOf(sync), syncSettingsOf(draft)) ? PRO_PROBLEM : null;
  const problem = draftProblem(draft, { calendarLimit: syncCalendarLimit(entitlements), saved: sync }) ?? proProblem;
  const conflictMessage = conflicts.length > 0 ? describeConflicts(conflicts, calendarsById) : null;
  const removals = describeRemovals(saveRemovals(sync, draft), calendarsById);

  // Name and Pause apply at once and never join the draft, so a later Save can't put back what they changed.
  const applyNow = (patch: { name?: string; paused?: boolean }) => {
    track(ANALYTICS_EVENTS.sync_updated, { field: Object.keys(patch).join(",") });
    setMutationError(null);
    void mutate({ ...sync, ...patch }, { revalidate: false });
    patchSync(syncId, patch, {
      onError: (patchError) => {
        setMutationError(resolveSyncError(patchError, "Failed to update this sync.", calendarsById));
        void mutate();
      },
      onSaved: (updated) => { void mutate(updated, { revalidate: false }); },
      onSettled: () => { void refresh(syncId); },
    });
  };

  const setPaused = (paused: boolean) => {
    track(paused ? ANALYTICS_EVENTS.sync_paused : ANALYTICS_EVENTS.sync_resumed);
    applyNow({ paused });
  };

  const save = async () => {
    const sent = draft;
    const body = toPatchBody(sync, sent);
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await saveSync(syncId, body);
      track(ANALYTICS_EVENTS.sync_updated, { field: Object.keys(body).filter((key) => key !== "expectedUpdatedAt").join(",") });
      await mutate(updated, { revalidate: false });
      setEdits((current) => settleEdits(current, sent));
      void refresh(syncId);
    } catch (saveFailure) {
      // The edits stay, laid over the latest copy, so the next Save is checked against what's there now.
      if (isStaleSyncError(saveFailure)) await mutate();
      setSaveError(resolveSyncError(saveFailure, "Failed to save this sync.", calendarsById));
    } finally {
      setSaving(false);
      setReviewOpen(false);
    }
  };

  const requestSave = () => {
    if (removals.length > 0) setReviewOpen(true);
    else void save();
  };

  const discard = () => {
    setEdits({});
    setSaveError(null);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteSync(syncId);
      track(ANALYTICS_EVENTS.sync_deleted);
      await refresh();
      await navigate({ ignoreBlocker: true, to: "/dashboard" });
    } catch (deleteError) {
      setMutationError(resolveSyncError(deleteError, "Failed to delete this sync.", calendarsById));
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  const attention = [...(sync.sources ?? []), ...sync.destinations].some((status) => status.problem !== null);

  return (
    <div className="@container flex flex-col gap-1.5 lg:h-full">
      <SyncPageHeader
        back={<BackButton to="/dashboard" />}
        title={sync.name}
        subtitle={<><SyncStatusDot state={sync.state} />{statusLine(sync)}</>}
        trailing={(
          <SegmentedControl
            label="Sync sections"
            value={tab}
            options={[
              { label: "Setup", value: "setup" },
              { label: <ActivityTabLabel attention={attention} />, value: "activity" },
            ]}
            onChange={(next) => {
              if (next === "activity") track(ANALYTICS_EVENTS.sync_activity_viewed);
              void navigate({
                params: { syncId },
                replace: true,
                search: { tab: next === "activity" ? "activity" : undefined },
                to: "/dashboard/syncs/$syncId",
              });
            }}
          />
        )}
      />
      <div className={cn("grid grid-cols-1 gap-x-8 lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)]", tab === "setup" && SYNC_PANE_COLUMNS)}>
        <div className={cn("flex min-w-0 flex-col lg:min-h-0", tab === "setup" && "@3xl:[--page-body-bleed-end:1rem]")}>
          <PageBody className="gap-1.5">
            {error && <Text size="sm" tone="danger" className="px-0.5">Couldn't refresh this sync. Showing what was last loaded.</Text>}
            {mutationError && <Text size="sm" tone="danger" className="px-0.5">{mutationError}</Text>}
            {tab === "setup" ? (
              <>
                <NavigationMenu>
                  {/* A save going out holds these back, so they can't fold into it and lose their own result. */}
                  <NavigationMenuEditableItem
                    label="Name"
                    value={sync.name}
                    disabled={saving}
                    onCommit={(name) => {
                      const nameProblem = syncNameProblem(name);
                      if (nameProblem) setMutationError(nameProblem);
                      else applyNow({ name });
                    }}
                  />
                  <NavigationMenuToggleItem checked={sync.paused} disabled={saving} onCheckedChange={setPaused}>
                    <NavigationMenuItemIcon>
                      <Pause size={15} />
                    </NavigationMenuItemIcon>
                    <NavigationMenuItemLabel>Pause This Sync</NavigationMenuItemLabel>
                  </NavigationMenuToggleItem>
                </NavigationMenu>
                {sync.paused && <MenuHint tone="attention">Paused. Copies stay as they are, and new events wait until you resume.</MenuHint>}
                <SyncEditor
                  value={draft}
                  calendars={calendars}
                  otherSyncs={otherSyncs}
                  locked={locked}
                  saved={sync}
                  previewClassName="@3xl:hidden"
                  notice={conflictMessage && <MenuHint tone="attention">{conflictMessage}</MenuHint>}
                  onChange={(patch) => setEdits((current) => ({ ...current, ...patch }))}
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
                <SaveSyncConfirmation
                  changes={[...new Set(changes.map((change) => describeChange(change, calendarsById)))]}
                  removals={removals}
                  open={reviewOpen}
                  saving={saving}
                  onOpenChange={setReviewOpen}
                  onConfirm={() => void save()}
                />
              </>
            ) : (
              <SyncActivity sync={sync} calendars={calendars} />
            )}
          </PageBody>
        </div>
        {tab === "setup" && (
          <aside className="hidden @3xl:block">
            <div className="sticky top-0 z-[6] has-[[data-popover-open]]:z-20">
              <SyncPreviewPanel
                settings={syncSettingsOf(draft)}
                directions={previewDirections(draft, calendarsById)}
              />
            </div>
          </aside>
        )}
      </div>
      <SyncActionBar
        show={dirty}
        label="Unsaved changes"
        message={saveError ?? problem ?? conflictMessage}
        busy={saving}
        secondary={{ label: "Discard", onClick: discard }}
        primary={{ label: "Save", onClick: requestSave, disabled: problem !== null || conflicts.length > 0 }}
      />
      {discardDialog}
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

function ActivityTabLabel({ attention }: { attention: boolean }) {
  if (!attention) return "Activity";
  return (
    <span className="flex items-center gap-1.5">
      Activity
      <SyncStatusDot state="problem" className="size-1.5" />
      <span className="sr-only">, needs attention</span>
    </span>
  );
}
