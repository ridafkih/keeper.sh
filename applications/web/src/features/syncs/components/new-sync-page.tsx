import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import useSWR from "swr";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import { BackButton } from "@/components/ui/primitives/back-button";
import { Button, ButtonText } from "@/components/ui/primitives/button";
import { DashboardHeading1 } from "@/components/ui/primitives/dashboard-heading";
import { MenuHint, PremiumHint } from "@/components/ui/primitives/menu-hint";
import { StickyPageHeader } from "@/components/ui/primitives/sticky-page-header";
import { Text } from "@/components/ui/primitives/text";
import { RouteShell } from "@/components/ui/shells/route-shell";
import { NavigationMenu } from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { NavigationMenuEditableItem } from "@/components/ui/composites/navigation-menu/navigation-menu-editable";
import { canAddMore, useEntitlements } from "@/hooks/use-entitlements";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import type { CalendarSource } from "@/types/api";
import { ProfileGallery } from "@/features/syncs/components/profile-gallery";
import { SyncEditor } from "@/features/syncs/components/sync-editor";
import { SyncPreviewPanel } from "@/features/syncs/components/sync-preview-panel";
import { resolveSyncError } from "@/features/syncs/sync-errors";
import { createSyncDraft, draftProblem, toCreateBody, type NewSyncSearch, type SyncDraft } from "@/features/syncs/sync-draft";
import { describeConflicts, findDraftConflicts, previewDirections, summarizeSync, syncPagePath, syncSettingsOf } from "@/features/syncs/syncs";
import type { SyncTemplateKey } from "@/features/syncs/templates";
import { createSync, useRefreshSyncs, useSyncs } from "@/features/syncs/use-syncs";
import { cn } from "@/utils/cn";

const initialDraft = ({ from, profile }: NewSyncSearch): SyncDraft | null => {
  if (from) return createSyncDraft(profile ?? null, { sourceCalendarIds: [from] });
  if (profile) return createSyncDraft(profile);
  return null;
};

function NewSyncHeader({ description }: { description: string }) {
  return (
    <StickyPageHeader className="gap-1.5">
      <div className="lg:hidden">
        <BackButton fallback="/dashboard" />
      </div>
      <div className="flex flex-col gap-1 px-0.5 pt-4">
        <DashboardHeading1 className="select-none">New Sync</DashboardHeading1>
        <Text size="sm" tone="muted">{description}</Text>
      </div>
    </StickyPageHeader>
  );
}

function NewSyncColumns({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="@container">
      <div className={cn("grid grid-cols-1 gap-x-8", aside && "@3xl:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]")}>
        <div className="flex min-w-0 flex-col gap-1.5">{children}</div>
        {aside && (
          <aside className="hidden @3xl:block">
            <div className="sticky top-0 has-[[data-popover-open]]:z-20">{aside}</div>
          </aside>
        )}
      </div>
    </div>
  );
}

export function NewSyncPage({ search }: { search: NewSyncSearch }) {
  const navigate = useNavigate();
  const { data: calendars, error, mutate } = useSWR<CalendarSource[]>("/api/sources");
  const { data: syncs } = useSyncs();
  const { data: entitlements } = useEntitlements();
  const refresh = useRefreshSyncs();
  const [draft, setDraft] = useState<SyncDraft | null>(() => initialDraft(search));
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  if (error) return <RouteShell backFallback="/dashboard" status="error" onRetry={() => { void mutate(); }} />;
  if (!calendars) return <RouteShell backFallback="/dashboard" status="loading" />;

  const calendarsById = new Map(calendars.map((calendar) => [calendar.id, calendar] as const));
  const atLimit = !canAddMore(entitlements?.syncs);
  const locked = Boolean(entitlements && !entitlements.canUseEventFilters);

  const pick = (template: SyncTemplateKey | null) => {
    track(ANALYTICS_EVENTS.sync_template_selected, { template: template ?? "scratch" });
    setDraft(createSyncDraft(template));
  };

  if (!draft) {
    return (
      <NewSyncColumns>
        <NewSyncHeader description="Start from a profile. It only fills in the form, and you can change everything after." />
        {atLimit && <PremiumHint>Free plans include one sync. Your existing syncs keep running.</PremiumHint>}
        <ProfileGallery disabled={atLimit} onPick={pick} />
      </NewSyncColumns>
    );
  }

  const conflicts = findDraftConflicts(draft, syncs ?? []);
  const problem = draftProblem(draft);
  const summary = summarizeSync(draft, calendarsById).split(" · ")[0] ?? "New sync";

  const create = async () => {
    if (conflicts.length > 0) {
      track(ANALYTICS_EVENTS.sync_conflict_shown);
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createSync(toCreateBody(draft, summary));
      track(ANALYTICS_EVENTS.sync_created, { mode: created.mode, share_as: created.shareAs, template: draft.template ?? "scratch" });
      await refresh();
      await navigate({ to: syncPagePath(created.id) });
    } catch (createFailure) {
      setCreateError(resolveSyncError(createFailure, "Failed to create this sync.", calendarsById));
      setCreating(false);
    }
  };

  return (
    <NewSyncColumns
      aside={
        <SyncPreviewPanel
          settings={syncSettingsOf(draft)}
          directions={previewDirections(draft, calendarsById)}
        />
      }
    >
      <NewSyncHeader description="Nothing syncs until you create it." />
      <NavigationMenu>
        <NavigationMenuEditableItem
          label="Name"
          value={draft.name || summary}
          onCommit={(name) => setDraft({ ...draft, name })}
        />
      </NavigationMenu>
      <SyncEditor
        value={draft}
        calendars={calendars}
        otherSyncs={syncs ?? []}
        locked={locked}
        previewClassName="@3xl:hidden"
        notice={conflicts.length > 0 && <MenuHint tone="attention">{describeConflicts(conflicts, calendarsById)}</MenuHint>}
        onChange={(patch) => setDraft({ ...draft, ...patch })}
      />
      <div className="flex flex-col gap-1.5 pt-3">
        {atLimit && <PremiumHint>Free plans include one sync.</PremiumHint>}
        {problem && <Text size="sm" tone="muted" align="center">{problem}</Text>}
        <Button
          className="w-full justify-center"
          disabled={creating || atLimit || problem !== null || conflicts.length > 0}
          onClick={() => void create()}
        >
          {creating && <LoaderCircle size={16} className="animate-spin" />}
          <ButtonText>Create Sync</ButtonText>
        </Button>
        <Button variant="elevated" className="w-full justify-center" onClick={() => setDraft(null)}>
          <ButtonText>Pick a Different Profile</ButtonText>
        </Button>
        {createError && <Text size="sm" tone="danger" align="center">{createError}</Text>}
      </div>
    </NewSyncColumns>
  );
}
