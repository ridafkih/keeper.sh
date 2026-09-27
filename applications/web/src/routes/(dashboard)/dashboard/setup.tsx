import { useCallback, useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import useSWR, { useSWRConfig } from "swr";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import { invalidateAccountsAndSources } from "@/lib/swr";
import { BackButton } from "@/components/ui/primitives/back-button";
import { Button, ButtonText, LinkButton } from "@/components/ui/primitives/button";
import { DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { heading } from "@/components/ui/primitives/heading.styles";
import { MenuHint, PremiumHint } from "@/components/ui/primitives/menu-hint";
import { Text } from "@/components/ui/primitives/text";
import { RouteShell } from "@/components/ui/shells/route-shell";
import { NavigationMenu } from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { NavigationMenuEditableItem } from "@/components/ui/composites/navigation-menu/navigation-menu-editable";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { canAddMore, useEntitlements } from "@/hooks/use-entitlements";
import type { AppJsonFetcher } from "@/lib/router-context";
import type { CalendarSource } from "@/types/api";
import {
  markPending,
  reconcileSources,
  resolveConnectedAccount,
  seedFirstConnect,
  withSync,
} from "@/features/setup/setup-draft";
import { useSetupDraft } from "@/features/setup/use-setup-draft";
import { useLoginImport } from "@/features/setup/use-login-import";
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

function SetupPage() {
  const { accountId } = Route.useSearch();
  const { sources: preloaded } = Route.useLoaderData();
  const navigate = useNavigate();
  const { draft, update, clear } = useSetupDraft();
  const { data: entitlements } = useEntitlements();
  const { data: sources, error, mutate } = useSWR<CalendarSource[]>("/api/sources", {
    fallbackData: preloaded ?? undefined,
  });
  const { data: syncs } = useSyncs();
  const refresh = useRefreshSyncs();
  const { mutate: globalMutate } = useSWRConfig();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const hydrated = draft !== null;

  const onImported = useCallback(async (importedAccountId: string) => {
    await invalidateAccountsAndSources(globalMutate);
    navigate({ replace: true, search: { accountId: importedAccountId }, to: "/dashboard/setup" });
  }, [globalMutate, navigate]);
  useLoginImport(hydrated && !accountId && sources?.length === 0, onImported);

  useEffect(() => {
    if (!hydrated || !sources || !syncs) return;
    if (accountId) {
      update((current) => seedFirstConnect(resolveConnectedAccount(current, sources, accountId), sources, syncs.length));
      navigate({ replace: true, search: {}, to: "/dashboard/setup" });
      return;
    }
    update((current) => seedFirstConnect(reconcileSources(current, sources), sources, syncs.length));
  }, [hydrated, sources, syncs, accountId, update, navigate]);

  if (error) return <RouteShell backFallback="/dashboard" status="error" onRetry={() => mutate()} />;
  if (!draft || !sources) return <RouteShell backFallback="/dashboard" status="loading" />;

  const calendarsById = new Map(sources.map((source) => [source.id, source] as const));
  const sync = draft.sync;
  const conflicts = findDraftConflicts(sync, syncs ?? []);
  const problem = draftProblem(sync);
  const atLimit = !canAddMore(entitlements?.syncs);
  const locked = Boolean(entitlements && !entitlements.canUseEventFilters);
  const summary = summarizeSync(sync, calendarsById).split(" · ")[0] ?? "My sync";

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
    <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-8 lg:grid-cols-[minmax(0,40rem)_minmax(0,26rem)] lg:justify-center lg:gap-12">
      <div className="flex min-w-0 flex-col gap-1.5">
        <BackButton fallback="/dashboard" />
        {draft.firstConnect ? (
          <div className="flex flex-col gap-1 px-0.5 pt-4">
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
          onChange={(patch) => {
            track(ANALYTICS_EVENTS.setup_blank_selected, { field: Object.keys(patch).join(",") });
            update((current) => withSync(current, { ...current.sync, ...patch }));
          }}
          onConnect={(role) => update((current) => markPending(current, role))}
        />
        <div className="flex flex-col gap-1.5 pt-3">
          {atLimit && <PremiumHint>Free plans include one sync.</PremiumHint>}
          {problem && <Text size="sm" tone="muted" align="center">{problem}</Text>}
          <Button
            className="w-full justify-center"
            disabled={starting || atLimit || problem !== null || conflicts.length > 0}
            onClick={() => void start()}
          >
            {starting && <LoaderCircle size={16} className="animate-spin" />}
            <ButtonText>Start Syncing</ButtonText>
          </Button>
          <LinkButton to="/dashboard/syncs/new" variant="elevated" className="w-full justify-center">
            <ButtonText>Pick a Different Profile</ButtonText>
          </LinkButton>
          <LinkButton to="/dashboard" variant="ghost" className="w-full justify-center" onClick={() => track(ANALYTICS_EVENTS.setup_skipped)}>
            <ButtonText>Skip for Now</ButtonText>
          </LinkButton>
          {startError && <Text size="sm" tone="danger" align="center">{startError}</Text>}
        </div>
      </div>
      <aside className="hidden lg:block">
        <div className="sticky top-12">
          <SyncPreviewPanel
            settings={syncSettingsOf(sync)}
            directions={previewDirections(sync, calendarsById)}
          />
        </div>
      </aside>
    </div>
  );
}
