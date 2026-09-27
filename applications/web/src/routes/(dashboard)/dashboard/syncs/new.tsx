import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import useSWR from "swr";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import { BackButton } from "@/components/ui/primitives/back-button";
import { Button, ButtonText } from "@/components/ui/primitives/button";
import { DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { MenuHint, PremiumHint } from "@/components/ui/primitives/menu-hint";
import { PageBody } from "@/components/ui/primitives/page-body";
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
import { resolveSyncError } from "@/features/syncs/sync-errors";
import { createSyncDraft, draftProblem, toCreateBody, type SyncDraft } from "@/features/syncs/sync-draft";
import { describeConflicts, findDraftConflicts, summarizeSync, syncPagePath } from "@/features/syncs/syncs";
import { isSyncTemplateKey, type SyncTemplateKey } from "@/features/syncs/templates";
import { createSync, useRefreshSyncs, useSyncs } from "@/features/syncs/use-syncs";

interface NewSyncSearch {
  from?: string;
  profile?: SyncTemplateKey;
}

export const Route = createFileRoute("/(dashboard)/dashboard/syncs/new")({
  component: NewSyncPage,
  validateSearch: (search: Record<string, unknown>): NewSyncSearch => ({
    from: typeof search.from === "string" ? search.from : undefined,
    profile: isSyncTemplateKey(search.profile) ? search.profile : undefined,
  }),
});

const initialDraft = ({ from, profile }: NewSyncSearch): SyncDraft | null => {
  if (from) return createSyncDraft(profile ?? null, { sourceCalendarIds: [from] });
  if (profile) return createSyncDraft(profile);
  return null;
};

function NewSyncPage() {
  const search = Route.useSearch();
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
      <div className="flex flex-col gap-1.5">
        <BackButton fallback="/dashboard" />
        <DashboardSection
          title="New Sync"
          description="Start from a profile. It only fills in the form, and you can change everything after."
        />
        {atLimit && <PremiumHint>Free plans include one sync. Your existing syncs keep running.</PremiumHint>}
        <ProfileGallery disabled={atLimit} onPick={pick} />
      </div>
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
    <div className="flex flex-col gap-1.5 lg:h-full">
      <StickyPageHeader className="gap-1.5">
        <BackButton fallback="/dashboard" />
        <DashboardSection title="New Sync" description="Nothing syncs until you create it." />
      </StickyPageHeader>
      <PageBody className="gap-1.5">
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
      </PageBody>
    </div>
  );
}
