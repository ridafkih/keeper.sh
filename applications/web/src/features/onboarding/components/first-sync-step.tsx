import { useEffect, useState } from "react";
import useSWR from "swr";
import { DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { ErrorState } from "@/components/ui/primitives/error-state";
import { heading } from "@/components/ui/primitives/heading.styles";
import { MenuHint } from "@/components/ui/primitives/menu-hint";
import { PageBody } from "@/components/ui/primitives/page-body";
import { Text } from "@/components/ui/primitives/text";
import { NavigationMenu } from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { NavigationMenuEditableItem } from "@/components/ui/composites/navigation-menu/navigation-menu-editable";
import { useEntitlements } from "@/hooks/use-entitlements";
import { ANALYTICS_EVENTS, track } from "@/lib/analytics";
import type { CalendarSource } from "@/types/api";
import { reconcileSources, seedFirstConnect, withSync } from "@/features/setup/setup-draft";
import { useSetupDraft } from "@/features/setup/use-setup-draft";
import { SYNC_SETUP_COLUMNS, SyncActionBar } from "@/features/syncs/components/sync-action-bar";
import { SyncEditor } from "@/features/syncs/components/sync-editor";
import { SyncPreviewPanel } from "@/features/syncs/components/sync-preview-panel";
import { resolveSyncError } from "@/features/syncs/sync-errors";
import { draftProblem, toCreateBody } from "@/features/syncs/sync-draft";
import {
  describeConflicts,
  findDraftConflicts,
  previewDirections,
  summarizeSync,
  syncSettingsOf,
} from "@/features/syncs/syncs";
import { createSync, useRefreshSyncs, useSyncs } from "@/features/syncs/use-syncs";
import { recordOnboarding } from "../record-onboarding";

interface FirstSyncStepProps {
  onAddCalendars: () => void;
  onStarted: (syncId: string) => void;
}

export function FirstSyncStep({ onAddCalendars, onStarted }: FirstSyncStepProps) {
  const { draft, update, clear } = useSetupDraft();
  const { data: entitlements, error: entitlementsError } = useEntitlements();
  const { data: sources, error: sourcesError, mutate: retrySources } = useSWR<CalendarSource[]>("/api/sources");
  const { data: syncs } = useSyncs();
  const refresh = useRefreshSyncs();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // Without the plan, start from what every plan can save rather than never filling the sentence in.
  const canUseEventFilters = entitlementsError ? false : entitlements?.canUseEventFilters;
  const hydrated = draft !== null;

  // Seeded here rather than on the way back from connecting, so every calendar connected so far is in the pool.
  useEffect(() => {
    if (!hydrated || !sources || !syncs || canUseEventFilters === undefined) return;
    update((current) => seedFirstConnect(reconcileSources(current, sources), sources, syncs.length, canUseEventFilters));
  }, [hydrated, sources, syncs, canUseEventFilters, update]);

  if (sourcesError) return <ErrorState onRetry={() => void retrySources()} />;
  if (!draft || !sources) return null;

  const calendarsById = new Map(sources.map((source) => [source.id, source] as const));
  const sync = draft.sync;
  const conflicts = findDraftConflicts(sync, syncs ?? []);
  const problem = draftProblem(sync);
  const summary = summarizeSync(sync, calendarsById).split(" · ")[0] ?? "My sync";
  const body = problem ? null : toCreateBody(sync, summary);
  const locked = Boolean(entitlements && !entitlements.canUseEventFilters);

  const start = async () => {
    if (!body) return;
    setStarting(true);
    setStartError(null);
    try {
      const created = await createSync(body);
      await recordOnboarding("completed").catch(() => undefined);
      track(ANALYTICS_EVENTS.onboarding_completed, { first_connect: draft.firstConnect, mode: created.mode });
      track(ANALYTICS_EVENTS.sync_created, { mode: created.mode, share_as: created.shareAs, template: sync.template ?? "scratch" });
      clear();
      await refresh();
      onStarted(created.id);
    } catch (startFailure) {
      setStartError(resolveSyncError(startFailure, "Failed to start syncing.", calendarsById));
      setStarting(false);
    }
  };

  return (
    // Laid out like the setup page: at lg the column scrolls under its heading while the preview and the bar stay put.
    <div className="mx-auto flex w-full max-w-6xl flex-col [--sidebar-pad-b:3rem] [--sidebar-pad-t:2.5rem] [--sidebar-pad-x:1.5rem] lg:min-h-0 lg:flex-1">
      <div className={`grid grid-cols-1 gap-8 lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)] lg:gap-12 ${SYNC_SETUP_COLUMNS}`}>
        <div className="flex min-w-0 flex-col gap-1.5 lg:min-h-0">
          <div className="flex flex-col gap-1.5 pb-1">
            {draft.firstConnect ? (
              <div className="flex flex-col gap-1 px-0.5">
                <h1 className={heading({ level: 2 })}>Your First Sync Is Ready</h1>
                <Text size="sm" tone="muted">We set it up with the usual choices. Read it back, change anything, then start.</Text>
              </div>
            ) : (
              <DashboardSection title="Tell Keeper What to Do" description="Fill in the blanks, read it back, then start syncing." />
            )}
          </div>
          <PageBody className="gap-1.5">
            <NavigationMenu>
              <NavigationMenuEditableItem
                label="Name"
                value={sync.name || summary}
                onCommit={(name) => update((current) => withSync(current, { ...current.sync, name }))}
              />
            </NavigationMenu>
            <SyncEditor
              value={sync}
              calendars={sources}
              otherSyncs={syncs ?? []}
              locked={locked}
              previewClassName="lg:hidden"
              notice={conflicts.length > 0 && <MenuHint tone="attention">{describeConflicts(conflicts, calendarsById)}</MenuHint>}
              onChange={(patch) => update((current) => withSync(current, { ...current.sync, ...patch }))}
            />
          </PageBody>
        </div>
        <aside className="hidden lg:block">
          <div className="relative z-[6] has-[[data-popover-open]]:z-20">
            <SyncPreviewPanel settings={syncSettingsOf(sync)} directions={previewDirections(sync, calendarsById)} />
          </div>
        </aside>
      </div>
      <SyncActionBar
        layout="setup"
        label="Not started yet"
        message={startError ?? problem}
        busy={starting}
        secondary={{ label: "Add Calendars", onClick: onAddCalendars }}
        primary={{ label: "Start Syncing", onClick: () => void start(), disabled: problem !== null || conflicts.length > 0 }}
      />
    </div>
  );
}
