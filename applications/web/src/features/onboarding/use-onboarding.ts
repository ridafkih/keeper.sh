import useSWR from "swr";
import { useAtomValue } from "jotai";
import { useEntitlements, hasConfiguredSync } from "@/hooks/use-entitlements";
import { syncStateAtom } from "@/state/sync";
import { chosenDestinationIdAtom, onboardingRunAtom } from "@/state/onboarding";
import type { CalendarAccount, CalendarSource } from "@/types/api";
import { proposeSync, resolveOrigin, listSameAccountDestinations } from "./sync-proposal";
import type { SyncProposal } from "./sync-proposal";
import { resolveOnboardingStep } from "./onboarding-step";
import type { OnboardingStep } from "./onboarding-step";
import { useCopiedEvents } from "./use-copied-events";
import { resolveCopiesVersion } from "./copies-version";
import type { CopiedEvents } from "./use-copied-events";

interface OnboardingState {
  step: OnboardingStep;
  calendars: CalendarSource[];
  accounts: CalendarAccount[];
  origin: CalendarSource | null;
  sameAccountDestinations: CalendarSource[];
  proposal: SyncProposal<CalendarSource> | null;
  copies: CopiedEvents | null;
}

export function useOnboarding(): OnboardingState | null {
  const { data: calendars } = useSWR<CalendarSource[]>("/api/sources");
  const { data: accounts } = useSWR<CalendarAccount[]>("/api/accounts");
  const { data: entitlements } = useEntitlements();
  const run = useAtomValue(onboardingRunAtom);
  const chosenDestinationId = useAtomValue(chosenDestinationIdAtom);
  const sync = useAtomValue(syncStateAtom);
  const copies = useCopiedEvents(run.phase === "started", resolveCopiesVersion(sync));

  if (!calendars || !accounts || !entitlements) {
    return null;
  }

  const activeCalendars = calendars.filter((calendar) => !calendar.disabled);
  const origin = resolveOrigin(activeCalendars, accounts);
  const proposal = proposeSync({
    accounts,
    calendars: activeCalendars,
    chosenDestinationId: chosenDestinationId ?? undefined,
  });

  const step = resolveOnboardingStep({
    copiedCount: copies?.count ?? null,
    hasCalendars: origin !== null,
    hasConfiguredSync: hasConfiguredSync(entitlements),
    hasProposal: proposal !== null,
    mappingSync: sync.mappings,
    run,
    syncing: sync.state === "syncing",
  });

  return {
    accounts,
    calendars: activeCalendars,
    copies,
    origin,
    proposal,
    sameAccountDestinations: origin ? listSameAccountDestinations(activeCalendars, origin) : [],
    step,
  };
}

export type { OnboardingState };
