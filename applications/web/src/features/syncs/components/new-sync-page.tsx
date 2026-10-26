import { useState, type ReactNode } from "react";
import { useBlocker } from "@tanstack/react-router";
import useSWR from "swr";
import { addsProSettings, diffSyncChanges } from "@keeper.sh/data-schemas";
import { BackButton } from "@/components/ui/primitives/back-button";
import { MenuHint, PremiumHint } from "@/components/ui/primitives/menu-hint";
import { PageBody } from "@/components/ui/primitives/page-body";
import { Text } from "@/components/ui/primitives/text";
import { RouteShell } from "@/components/ui/shells/route-shell";
import { NavigationMenu } from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { NavigationMenuEditableItem } from "@/components/ui/composites/navigation-menu/navigation-menu-editable";
import { canAddMore, useEntitlements, type Entitlements } from "@/hooks/use-entitlements";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import type { CalendarSource } from "@/types/api";
import { ProfileGallery } from "@/features/syncs/components/profile-gallery";
import { SYNC_PANE_COLUMNS, SyncActionBar } from "@/features/syncs/components/sync-action-bar";
import { SyncEditor } from "@/features/syncs/components/sync-editor";
import { SyncPageHeader } from "@/features/syncs/components/sync-page-header";
import { SyncPreviewPanel } from "@/features/syncs/components/sync-preview-panel";
import { DiscardChangesConfirmation } from "@/features/syncs/components/sync-save-dialogs";
import {
  createSyncDraft,
  draftFallbackName,
  draftProblem,
  pruneStaleIds,
  syncNameProblem,
  type NewSyncSearch,
  type SyncDraft,
} from "@/features/syncs/sync-draft";
import { isSyncLocked, syncCalendarLimit } from "@/features/syncs/sync-plan";
import { describeConflicts, findDraftConflicts, previewDirections, syncSettingsOf } from "@/features/syncs/syncs";
import type { SyncTemplateKey } from "@/features/syncs/templates";
import { useCreateSync, useTrackConflicts } from "@/features/syncs/use-create-sync";
import { useSyncs } from "@/features/syncs/use-syncs";
import { cn } from "@/utils/cn";

const AT_LIMIT_MESSAGE = "Free plans include one sync.";
const CHANGE_PROFILE_MESSAGE = "Picking another profile starts over, so the calendars and settings you've chosen here are lost.";

function NewSyncHeader({ description }: { description: string }) {
  return <SyncPageHeader back={<BackButton fallback="/dashboard" />} title="New Sync" subtitle={description} />;
}

interface NewSyncColumnsProps {
  header: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
  footer?: ReactNode;
}

function NewSyncColumns({ header, children, aside, footer }: NewSyncColumnsProps) {
  return (
    <div className="@container flex flex-col gap-1.5 lg:h-full">
      {header}
      <div className={cn("grid grid-cols-1 gap-x-8 lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)]", aside && SYNC_PANE_COLUMNS)}>
        <div className={cn("flex min-w-0 flex-col lg:min-h-0", aside && "@3xl:[--page-body-bleed-end:1rem]")}>
          <PageBody className="gap-1.5">{children}</PageBody>
        </div>
        {aside && (
          <aside className="hidden @3xl:block">
            <div className="sticky top-0 z-[6] has-[[data-popover-open]]:z-20">{aside}</div>
          </aside>
        )}
      </div>
      {footer}
    </div>
  );
}

// Waits for the plan as well as the calendars, since a free plan's profiles start without their Pro settings.
export function NewSyncPage({ search }: { search: NewSyncSearch }) {
  const { data: calendars, error, mutate } = useSWR<CalendarSource[]>("/api/sources");
  const { data: entitlements, isLoading: entitlementsLoading } = useEntitlements();

  if (error) return <RouteShell backFallback="/dashboard" status="error" onRetry={() => { void mutate(); }} />;
  if (!calendars || (!entitlements && entitlementsLoading)) return <RouteShell backFallback="/dashboard" status="loading" />;
  return <NewSyncForm search={search} calendars={calendars} entitlements={entitlements} />;
}

interface NewSyncFormProps {
  search: NewSyncSearch;
  calendars: CalendarSource[];
  entitlements: Entitlements | undefined;
}

function NewSyncForm({ search, calendars, entitlements }: NewSyncFormProps) {
  const { data: syncs } = useSyncs();
  const locked = isSyncLocked(entitlements);
  const calendarsById = new Map(calendars.map((calendar) => [calendar.id, calendar] as const));
  const startFrom = (template: SyncTemplateKey | null): SyncDraft =>
    createSyncDraft(template, search.from ? { sourceCalendarIds: [search.from] } : {}, { locked });
  const [start, setStart] = useState<SyncDraft | null>(() => (search.from || search.profile ? startFrom(search.profile ?? null) : null));
  const [rawDraft, setDraft] = useState<SyncDraft | null>(start);
  const [changingProfile, setChangingProfile] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const { create, creating, error: createError } = useCreateSync(calendarsById);

  const draft = rawDraft && pruneStaleIds(rawDraft, calendars);
  const dirty = Boolean(draft && start && diffSyncChanges(pruneStaleIds(start, calendars), draft).length > 0);
  const conflicts = draft ? findDraftConflicts(draft, syncs ?? []) : [];
  useTrackConflicts(conflicts.length > 0);

  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => dirty && next.pathname !== current.pathname,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });

  const atLimit = !canAddMore(entitlements?.syncs);

  const pick = (template: SyncTemplateKey | null) => {
    track(ANALYTICS_EVENTS.sync_template_selected, { template: template ?? "scratch" });
    const next = startFrom(template);
    setStart(next);
    setDraft(next);
  };

  const backToProfiles = () => {
    setChangingProfile(false);
    setNameError(null);
    setStart(null);
    setDraft(null);
  };

  const dialogs = (
    <>
      <DiscardChangesConfirmation
        open={blocker.status === "blocked"}
        description="This sync hasn't been created yet, so leaving loses it."
        onKeepEditing={() => blocker.reset?.()}
        onDiscard={() => blocker.proceed?.()}
      />
      <DiscardChangesConfirmation
        open={changingProfile}
        description={CHANGE_PROFILE_MESSAGE}
        onKeepEditing={() => setChangingProfile(false)}
        onDiscard={backToProfiles}
      />
    </>
  );

  if (!draft) {
    return (
      <NewSyncColumns header={<NewSyncHeader description="Start from a profile. It only fills in the form, and you can change everything after." />}>
        {atLimit && <PremiumHint>Free plans include one sync. Your existing syncs keep running.</PremiumHint>}
        <ProfileGallery disabled={atLimit} locked={locked} onPick={pick} />
        {dialogs}
      </NewSyncColumns>
    );
  }

  const proProblem = locked && addsProSettings(null, syncSettingsOf(draft)) ? "Pro settings need a Pro plan. Take them out to create this sync." : null;
  const problem = draftProblem(draft, { calendarLimit: syncCalendarLimit(entitlements) }) ?? proProblem;
  const conflictMessage = conflicts.length > 0 ? describeConflicts(conflicts, calendarsById) : null;
  const summary = draftFallbackName(draft, calendarsById);

  return (
    <NewSyncColumns
      header={<NewSyncHeader description="Nothing syncs until you create it." />}
      aside={
        <SyncPreviewPanel
          settings={syncSettingsOf(draft)}
          directions={previewDirections(draft, calendarsById)}
        />
      }
      footer={
        <SyncActionBar
          label="Not created yet"
          message={createError ?? (atLimit ? AT_LIMIT_MESSAGE : null) ?? problem ?? conflictMessage}
          busy={creating}
          secondary={{ label: "Change Profile", onClick: () => (dirty ? setChangingProfile(true) : backToProfiles()) }}
          primary={{ label: "Create Sync", onClick: () => void create(draft), disabled: atLimit || problem !== null || conflicts.length > 0 }}
        />
      }
    >
      {nameError && <Text size="sm" tone="danger" className="px-0.5">{nameError}</Text>}
      <NavigationMenu>
        <NavigationMenuEditableItem
          label="Name"
          value={draft.name || summary}
          onCommit={(name) => {
            const nameProblem = syncNameProblem(name);
            setNameError(nameProblem);
            if (!nameProblem) setDraft({ ...draft, name });
          }}
        />
      </NavigationMenu>
      <SyncEditor
        value={draft}
        calendars={calendars}
        otherSyncs={syncs ?? []}
        locked={locked}
        previewClassName="@3xl:hidden"
        notice={conflictMessage && <MenuHint tone="attention">{conflictMessage}</MenuHint>}
        onChange={(patch) => setDraft((current) => current && { ...current, ...patch })}
      />
      {atLimit && <div className="pt-3"><PremiumHint>{AT_LIMIT_MESSAGE}</PremiumHint></div>}
      {dialogs}
    </NewSyncColumns>
  );
}
