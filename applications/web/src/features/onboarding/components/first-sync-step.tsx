import { useEffect, useState } from "react";
import useSWR from "swr";
import CircleCheck from "lucide-react/dist/esm/icons/circle-check";
import { DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { heading } from "@/components/ui/primitives/heading.styles";
import { MenuHint } from "@/components/ui/primitives/menu-hint";
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
import { draftProblem, toCreateBody, type SyncDraft } from "@/features/syncs/sync-draft";
import {
  describeConflicts,
  findDraftConflicts,
  previewDirections,
  summarizeSync,
  syncSettingsOf,
} from "@/features/syncs/syncs";
import { createSync, useRefreshSyncs, useSyncs } from "@/features/syncs/use-syncs";
import { recordOnboarding } from "../record-onboarding";
import { describeCopies, describeWindow, joinNames, useSyncEstimate } from "../sync-estimate";

interface FirstSyncStepProps {
  onAddCalendars: () => void;
  onStarted: (syncId: string) => void;
}

const destinationIds = (sync: SyncDraft): string[] =>
  sync.mode === "both_ways" ? sync.memberCalendarIds : sync.destinationCalendarIds;

function EstimateSummary({ sync, body, calendarsById }: {
  sync: SyncDraft;
  body: ReturnType<typeof toCreateBody> | null;
  calendarsById: ReadonlyMap<string, CalendarSource>;
}) {
  const { data: estimate, error } = useSyncEstimate(body);
  const destinations = joinNames(destinationIds(sync).flatMap((id) => {
    const calendar = calendarsById.get(id);
    if (!calendar) return [];
    return [`${calendar.name} (${calendar.email ?? calendar.accountLabel})`];
  }));
  const reassurance = "Your own events are never edited or deleted, and you can remove the copies any time.";

  let lead = <Text as="span" size="sm" tone="muted">Working out what this will copy. </Text>;
  if (error || !body) {
    lead = <></>;
  } else if (estimate) {
    lead = (
      <>
        <Text as="span" size="sm" tone="default" className="font-medium">
          Adds about {describeCopies(estimate.nearTerm.count, sync.shareAs)} over the next 4 weeks
        </Text>
        <Text as="span" size="sm" tone="muted">
          {" "}to {destinations}, and about {estimate.total.count.toLocaleString()} in all, {describeWindow(estimate)}.{" "}
        </Text>
      </>
    );
  }

  return (
    <div className="flex items-start gap-2.5">
      <CircleCheck size={16} className="mt-0.5 shrink-0 text-foreground-muted" />
      <p className="leading-relaxed">
        {lead}
        <Text as="span" size="sm" tone="muted">{reassurance}</Text>
      </p>
    </div>
  );
}

export function FirstSyncStep({ onAddCalendars, onStarted }: FirstSyncStepProps) {
  const { draft, update, clear } = useSetupDraft();
  const { data: entitlements } = useEntitlements();
  const { data: sources } = useSWR<CalendarSource[]>("/api/sources");
  const { data: syncs } = useSyncs();
  const refresh = useRefreshSyncs();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const canUseEventFilters = entitlements?.canUseEventFilters;
  const hydrated = draft !== null;

  // Seeded here rather than on the way back from connecting, so every calendar connected so far is in the pool.
  useEffect(() => {
    if (!hydrated || !sources || !syncs || canUseEventFilters === undefined) return;
    update((current) => seedFirstConnect(reconcileSources(current, sources), sources, syncs.length, canUseEventFilters));
  }, [hydrated, sources, syncs, canUseEventFilters, update]);

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
    <div className="mx-auto flex w-full max-w-6xl flex-col">
      <div className={`grid grid-cols-1 gap-8 lg:gap-12 ${SYNC_SETUP_COLUMNS}`}>
        <div className="flex min-w-0 flex-col gap-1.5">
          {draft.firstConnect ? (
            <div className="flex flex-col gap-1 px-0.5 pb-3">
              <h1 className={heading({ level: 2 })}>Your First Sync Is Ready</h1>
              <Text size="sm" tone="muted">We set it up with the usual choices. Read it back, change anything, then start.</Text>
            </div>
          ) : (
            <DashboardSection title="Tell Keeper What to Do" description="Fill in the blanks, read it back, then start syncing." />
          )}
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
        summary={<EstimateSummary sync={sync} body={body} calendarsById={calendarsById} />}
        message={startError ?? problem}
        busy={starting}
        secondary={{ label: "Add Calendars", onClick: onAddCalendars }}
        primary={{ label: "Start Syncing", onClick: () => void start(), disabled: problem !== null || conflicts.length > 0 }}
      />
    </div>
  );
}
