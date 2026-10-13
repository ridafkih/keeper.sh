import { useCallback, useEffect, useState } from "react";
import Plus from "lucide-react/dist/esm/icons/plus";
import Waypoints from "lucide-react/dist/esm/icons/waypoints";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import useSWR, { useSWRConfig } from "swr";
import { invalidateAccountsAndSources } from "@/lib/swr";
import { BackButton } from "@/components/ui/primitives/back-button";
import { ButtonText, LinkButton } from "@/components/ui/primitives/button";
import { DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { heading } from "@/components/ui/primitives/heading.styles";
import { MenuHint, PremiumHint } from "@/components/ui/primitives/menu-hint";
import { PageBody } from "@/components/ui/primitives/page-body";
import { StickyPageHeader } from "@/components/ui/primitives/sticky-page-header";
import { Text } from "@/components/ui/primitives/text";
import { RouteShell } from "@/components/ui/shells/route-shell";
import {
  NavigationMenu,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
  NavigationMenuLinkItem,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { NavigationMenuEditableItem } from "@/components/ui/composites/navigation-menu/navigation-menu-editable";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { canAddMore, useEntitlements } from "@/hooks/use-entitlements";
import type { AppJsonFetcher } from "@/lib/router-context";
import type { CalendarSource } from "@/types/api";
import {
  applyTemplate,
  markPending,
  reconcileSources,
  resolveAddToSyncTargets,
  resolveConnectedAccount,
  seedFirstConnect,
  withSync,
  type AddToSyncTarget,
} from "@/features/setup/setup-draft";
import { useSetupDraft } from "@/features/setup/use-setup-draft";
import { useLoginImport, type LoginImportStatus } from "@/features/setup/use-login-import";
import { ProfileGallery } from "@/features/syncs/components/profile-gallery";
import type { SyncTemplateKey } from "@/features/syncs/templates";
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
  syncPagePath,
  syncSettingsOf,
} from "@/features/syncs/syncs";
import { createSync, useRefreshSyncs, useSyncs } from "@/features/syncs/use-syncs";

interface SetupSearch {
  accountId?: string;
}

async function loadSources(fetchApi: AppJsonFetcher): Promise<CalendarSource[] | null> {
  try {
    return await fetchApi<CalendarSource[]>("/api/sources");
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/(dashboard)/dashboard/setup")({
  validateSearch: (search: Record<string, unknown>): SetupSearch => ({
    accountId: typeof search.accountId === "string" ? search.accountId : undefined,
  }),
  loader: async ({ context }) => ({ sources: await loadSources(context.fetchApi) }),
  component: SetupPage,
});

function ExistingSyncs({ targets, atLimit }: { targets: AddToSyncTarget[]; atLimit: boolean }) {
  const offering = targets.some((target) => target.calendar !== null);
  let description = "Or fill in the blanks below to start another one.";
  if (atLimit) description = "Free plans include one sync, so new calendars join the one you have.";

  return (
    <>
      <DashboardSection title={offering ? "Add to a Sync You Have" : "Your Syncs"} description={description} />
      <NavigationMenu>
        {targets.map(({ sync, calendar }) => (
          <NavigationMenuLinkItem
            key={sync.id}
            to={syncPagePath(sync.id)}
            search={calendar ? { addCalendar: calendar.id } : undefined}
          >
            <NavigationMenuItemIcon>
              {calendar ? <Plus size={15} /> : <Waypoints size={15} />}
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>
              {calendar ? `Add ${calendar.name} to ${sync.name}` : `Open ${sync.name}`}
            </NavigationMenuItemLabel>
            <NavigationMenuItemTrailing />
          </NavigationMenuLinkItem>
        ))}
      </NavigationMenu>
    </>
  );
}

function LoginImportNotice({ status, onRetry }: { status: LoginImportStatus; onRetry: () => void }) {
  if (status === "importing") return <MenuHint>Bringing in the calendars from your sign-in…</MenuHint>;
  if (status !== "failed") return null;
  return (
    <Text size="sm" tone="danger" className="px-0.5">
      Couldn&apos;t bring in the calendars from your sign-in.{" "}
      <button type="button" className="underline underline-offset-2" onClick={onRetry}>Try again</button>
    </Text>
  );
}

function SetupPage() {
  const { accountId } = Route.useSearch();
  const { sources: preloaded } = Route.useLoaderData();
  const navigate = useNavigate();
  const { draft, update, clear } = useSetupDraft();
  const { data: entitlements, error: entitlementsError } = useEntitlements();
  const { data: sources, error, mutate } = useSWR<CalendarSource[]>("/api/sources", {
    fallbackData: preloaded ?? undefined,
  });
  const { data: syncs } = useSyncs();
  const refresh = useRefreshSyncs();
  const { mutate: globalMutate } = useSWRConfig();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [choosingProfile, setChoosingProfile] = useState(false);
  const hydrated = draft !== null;

  // The imported calendars reach /api/sources, where the seed below picks them up like any others.
  const onImported = useCallback(() => invalidateAccountsAndSources(globalMutate), [globalMutate]);
  const loginImport = useLoginImport(hydrated && !accountId && sources?.length === 0, onImported);

  // Without the plan, start from what every plan can save rather than never filling the sentence in.
  const canUseEventFilters = entitlementsError ? false : entitlements?.canUseEventFilters;
  useEffect(() => {
    if (!hydrated || !sources || !syncs || canUseEventFilters === undefined) return;
    if (accountId) {
      update((current) => seedFirstConnect(resolveConnectedAccount(current, sources, accountId), sources, syncs.length, canUseEventFilters));
      navigate({ replace: true, search: {}, to: "/dashboard/setup" });
      return;
    }
    update((current) => seedFirstConnect(reconcileSources(current, sources), sources, syncs.length, canUseEventFilters));
  }, [hydrated, sources, syncs, accountId, canUseEventFilters, update, navigate]);

  if (error) return <RouteShell backFallback="/dashboard" status="error" onRetry={() => mutate()} />;
  if (!draft || !sources) return <RouteShell backFallback="/dashboard" status="loading" />;

  const calendarsById = new Map(sources.map((source) => [source.id, source] as const));
  const sync = draft.sync;
  const conflicts = findDraftConflicts(sync, syncs ?? []);
  const problem = draftProblem(sync);
  const atLimit = !canAddMore(entitlements?.syncs);
  const locked = Boolean(entitlements && !entitlements.canUseEventFilters);
  const summary = summarizeSync(sync, calendarsById).split(" · ")[0] ?? "My sync";
  const targets = resolveAddToSyncTargets(syncs ?? [], sources, draft.connectedAccountId);
  const offers = targets.filter((target) => target.calendar !== null);
  let existing: AddToSyncTarget[] = offers;
  if (atLimit) existing = targets;

  const pickProfile = (template: SyncTemplateKey | null) => {
    track(ANALYTICS_EVENTS.sync_template_selected, { template: template ?? "scratch" });
    update((current) => applyTemplate(current, template, calendarsById, canUseEventFilters === false));
    setChoosingProfile(false);
  };

  const start = async () => {
    setStarting(true);
    setStartError(null);
    try {
      const created = await createSync(toCreateBody(sync, summary));
      track(ANALYTICS_EVENTS.setup_completed, { first_connect: draft.firstConnect, mode: created.mode });
      track(ANALYTICS_EVENTS.sync_created, { mode: created.mode, share_as: created.shareAs, template: sync.template ?? "scratch" });
      clear();
      await refresh();
      await navigate({ to: syncPagePath(created.id) });
    } catch (startFailure) {
      setStartError(resolveSyncError(startFailure, "Failed to start syncing.", calendarsById));
      setStarting(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col [--sidebar-pad-b:3rem] [--sidebar-pad-t:3rem] [--sidebar-pad-x:1.5rem] lg:h-[calc(100dvh-6rem)]">
      <div className={`grid grid-cols-1 gap-8 lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)] lg:gap-12 ${SYNC_SETUP_COLUMNS}`}>
        <div className="flex min-w-0 flex-col gap-1.5 lg:min-h-0">
          <StickyPageHeader className="gap-1.5">
            <BackButton fallback="/dashboard" />
            {draft.firstConnect ? (
              <div className="flex flex-col gap-1 px-0.5 pt-4">
                <h1 className={heading({ level: 2 })}>Your First Sync Is Ready</h1>
                <Text size="sm" tone="muted">We set it up with the usual choices. Read it back, change anything, then start.</Text>
              </div>
            ) : (
              <DashboardSection title="Tell Keeper What to Do" description="Fill in the blanks, read it back, then start syncing." />
            )}
          </StickyPageHeader>
          <PageBody className="gap-1.5">
            <LoginImportNotice status={sources.length === 0 ? loginImport.status : "done"} onRetry={loginImport.retry} />
            {existing.length > 0 && <ExistingSyncs targets={existing} atLimit={atLimit} />}
            <NavigationMenu>
              <NavigationMenuEditableItem
                label="Name"
                value={sync.name || summary}
                onCommit={(name) => update((current) => withSync(current, { ...current.sync, name }))}
              />
            </NavigationMenu>
            {choosingProfile ? (
              <ProfileGallery onPick={pickProfile} />
            ) : (
              <SyncEditor
                value={sync}
                calendars={sources}
                otherSyncs={syncs ?? []}
                locked={locked}
                previewClassName="lg:hidden"
                notice={conflicts.length > 0 && <MenuHint tone="attention">{describeConflicts(conflicts, calendarsById)}</MenuHint>}
                onChange={(patch) => {
                  track(ANALYTICS_EVENTS.setup_blank_selected, { field: Object.keys(patch).join(",") });
                  update((current) => withSync(current, { ...current.sync, ...patch }));
                }}
                onConnect={(role) => update((current) => markPending(current, role))}
              />
            )}
            <div className="flex flex-col gap-1.5 pt-3">
              {atLimit && <PremiumHint>Free plans include one sync.</PremiumHint>}
              <LinkButton to="/dashboard" variant="ghost" className="w-full justify-center" onClick={() => track(ANALYTICS_EVENTS.setup_skipped)}>
                <ButtonText>Skip for Now</ButtonText>
              </LinkButton>
            </div>
          </PageBody>
        </div>
        <aside className="hidden lg:block">
          <div className="relative z-[6] has-[[data-popover-open]]:z-20">
            <SyncPreviewPanel
              settings={syncSettingsOf(sync)}
              directions={previewDirections(sync, calendarsById)}
            />
          </div>
        </aside>
      </div>
      <SyncActionBar
        layout="setup"
        label="Not started yet"
        message={startError ?? problem}
        busy={starting}
        secondary={{ label: choosingProfile ? "Keep This Profile" : "Change Profile", onClick: () => setChoosingProfile(!choosingProfile) }}
        primary={{ label: "Start Syncing", onClick: () => void start(), disabled: choosingProfile || atLimit || problem !== null || conflicts.length > 0 }}
      />
    </div>
  );
}
