import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import useSWR, { useSWRConfig } from "swr";
import { AnimatePresence, LazyMotion, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { loadMotionFeatures } from "@/lib/motion-features";
import { invalidateAccountsAndSources } from "@/lib/swr";
import { BackButton } from "@/components/ui/primitives/back-button";
import { DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { RouteShell } from "@/components/ui/shells/route-shell";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { useEntitlements } from "@/hooks/use-entitlements";
import type { AppJsonFetcher } from "@/lib/router-context";
import type { CalendarSource } from "@/types/api";
import {
  addReverseRule,
  addRule,
  canReverse,
  clearPending,
  completeRules,
  markPending,
  pruneStaleIds,
  removeDestination,
  removeRule,
  resolveConnectedAccount,
  setBlank,
  setRuleDetail,
  takenIds,
  type SetupBlank,
  type SetupDraft,
} from "@/features/setup/setup-draft";
import { buildDestinationPuts, countNewMappings, exceedsMappingLimit } from "@/features/setup/setup-commit";
import { useSetupDraft } from "@/features/setup/use-setup-draft";
import { useCommitRules } from "@/features/setup/use-commit-rules";
import { useLoginImport } from "@/features/setup/use-login-import";
import { CalendarOptions } from "@/features/setup/components/calendar-options";
import { DetailOptions } from "@/features/setup/components/detail-options";
import { SentencePanel } from "@/features/setup/components/sentence-panel";
import { SetupActions } from "@/features/setup/components/setup-actions";
import { SetupSentence } from "@/features/setup/components/setup-sentence";
import { sameSlot, type SentenceSlot } from "@/features/setup/sentence-slot";

interface SetupSearch {
  accountId?: string;
}

interface OpenSlot {
  ruleId: string;
  slot: SentenceSlot;
}

const RULE_HIDDEN = { height: 0, opacity: 0, filter: "blur(4px)" };
const RULE_VISIBLE = { height: "fit-content", opacity: 1, filter: "blur(0)" };
const RULE_CLIP = { overflow: "clip" as const, overflowClipMargin: 4 };
const RULE_TRANSITION = { duration: 0.3, ease: [0.4, 0, 0.2, 1] as const };
const INSTANT = { duration: 0 };

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

const isBlank = (slot: SentenceSlot): slot is SetupBlank => slot.kind !== "detail";

const selectedFor = (rule: { fromId: string | null; toIds: string[] }, blank: SetupBlank): string | null =>
  blank.kind === "from" ? rule.fromId : rule.toIds[blank.index] ?? null;

function SetupPage() {
  const { accountId } = Route.useSearch();
  const { sources: preloaded } = Route.useLoaderData();
  const navigate = useNavigate();
  const { draft, update, clear } = useSetupDraft();
  const { data: entitlements } = useEntitlements();
  const { data: sources, error, mutate } = useSWR<CalendarSource[]>("/api/sources", {
    fallbackData: preloaded ?? undefined,
  });
  const [open, setOpen] = useState<OpenSlot | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion() ?? false;
  const { mutate: globalMutate } = useSWRConfig();
  const { commit, status } = useCommitRules({ clear, draft, entitlements, update });
  const hydrated = draft !== null;

  const onImported = useCallback(async (importedAccountId: string) => {
    await invalidateAccountsAndSources(globalMutate);
    navigate({ replace: true, search: { accountId: importedAccountId }, to: "/dashboard/setup" });
  }, [globalMutate, navigate]);
  useLoginImport(hydrated && !accountId && sources?.length === 0, onImported);

  useEffect(() => {
    if (!hydrated || !sources) return;
    if (accountId) {
      update((current) => resolveConnectedAccount(pruneStaleIds(current, sources), sources, accountId));
      navigate({ replace: true, search: {}, to: "/dashboard/setup" });
      return;
    }
    update((current) => clearPending(pruneStaleIds(current, sources)));
  }, [hydrated, sources, accountId, update, navigate]);

  const calendarsById = useMemo(
    () => new Map((sources ?? []).map((source) => [source.id, source] as const)),
    [sources],
  );

  const close = useCallback(() => setOpen(null), []);

  if (error) return <RouteShell backFallback="/dashboard" status="error" onRetry={() => mutate()} />;
  if (!draft || !sources) return <RouteShell backFallback="/dashboard" status="loading" />;

  const openRule = open ? draft.rules.find((rule) => rule.id === open.ruleId) : undefined;
  const reversible = draft.rules.find((rule) => canReverse(draft, rule.id, calendarsById));
  const rules = completeRules(draft);
  const puts = buildDestinationPuts(rules, {});
  const projected = (entitlements?.mappings.current ?? 0) + countNewMappings(puts, {});
  const limit = entitlements?.mappings.limit ?? null;
  const detailLocked = !entitlements || !entitlements.canUseEventFilters;

  const toggle = (ruleId: string, slot: SentenceSlot) => {
    setOpen((current) => (current?.ruleId === ruleId && sameSlot(current.slot, slot) ? null : { ruleId, slot }));
  };

  const select = (ruleId: string, blank: SetupBlank, calendarId: string, selectedId: string | null) => {
    track(ANALYTICS_EVENTS.setup_blank_selected, { blank: blank.kind, source: "calendar" });
    update((current) => (
      calendarId === selectedId && blank.kind === "to"
        ? removeDestination(current, ruleId, calendarId)
        : setBlank(current, ruleId, blank, calendarId)
    ));
    close();
  };

  const connect = (ruleId: string, blank: SetupBlank) => {
    track(ANALYTICS_EVENTS.setup_blank_selected, { blank: blank.kind, source: "connect" });
    update((current) => markPending(current, ruleId, blank));
  };

  const applyDraft = (event: string, updater: (current: SetupDraft) => SetupDraft) => {
    track(event);
    update(updater);
    close();
  };

  return (
    <div className="flex flex-col gap-1.5">
      <BackButton fallback="/dashboard" />
      <DashboardSection
        title="Tell Keeper What to Do"
        description="Fill in the blanks, read it back, then start syncing."
      />
      <div ref={anchorRef} className="relative z-20 flex flex-col gap-1.5">
        <LazyMotion features={loadMotionFeatures}>
          <div className="flex flex-col px-0.5 py-2">
            <AnimatePresence initial={false}>
              {draft.rules.map((rule) => (
                <m.div
                  key={rule.id}
                  style={RULE_CLIP}
                  initial={RULE_HIDDEN}
                  animate={RULE_VISIBLE}
                  exit={RULE_HIDDEN}
                  transition={reduceMotion ? INSTANT : RULE_TRANSITION}
                >
                  <div className="py-1.5">
                    <SetupSentence
                      rule={rule}
                      calendarsById={calendarsById}
                      openSlot={open?.ruleId === rule.id ? open.slot : null}
                      onOpen={(slot) => toggle(rule.id, slot)}
                      onRemove={draft.rules.length > 1 ? () => applyDraft(ANALYTICS_EVENTS.setup_rule_removed, (current) => removeRule(current, rule.id)) : undefined}
                    />
                  </div>
                </m.div>
              ))}
            </AnimatePresence>
          </div>
        </LazyMotion>
        <SentencePanel open={open !== null} anchorRef={anchorRef} onClose={close}>
          {open && openRule && isBlank(open.slot) && (
            <CalendarOptions
              blank={open.slot}
              calendars={sources}
              excludeIds={takenIds(openRule, open.slot)}
              selectedId={selectedFor(openRule, open.slot)}
              onSelect={(calendarId) => select(openRule.id, open.slot as SetupBlank, calendarId, selectedFor(openRule, open.slot as SetupBlank))}
              onConnect={() => connect(openRule.id, open.slot as SetupBlank)}
            />
          )}
          {open && openRule && open.slot.kind === "detail" && (
            <DetailOptions
              selected={openRule.detail}
              locked={detailLocked}
              onSelect={(detail) => {
                track(ANALYTICS_EVENTS.setup_detail_selected, { detail });
                update((current) => setRuleDetail(current, openRule.id, detail));
                close();
              }}
            />
          )}
        </SentencePanel>
      </div>
      <SetupActions
        canReverse={Boolean(reversible)}
        onReverse={() => reversible && applyDraft(ANALYTICS_EVENTS.setup_reverse_added, (current) => addReverseRule(current, reversible.id, calendarsById))}
        onAddRule={() => applyDraft(ANALYTICS_EVENTS.setup_rule_added, addRule)}
        canStart={rules.length > 0}
        starting={status.kind === "committing"}
        onStart={() => void commit()}
        onSkip={() => track(ANALYTICS_EVENTS.setup_skipped)}
        projected={projected}
        limit={limit}
        overLimit={status.kind === "limit" || exceedsMappingLimit(projected, limit)}
        error={status.kind === "error" ? status.message : null}
      />
    </div>
  );
}
