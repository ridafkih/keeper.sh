import { useEffect } from "react";
import { useStore } from "jotai";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { onboardingRunAtom } from "@/state/onboarding";
import { isFirstSyncOutcome } from "./onboarding-step";
import type { OnboardingStep } from "./onboarding-step";

export function useSettleFirstSync(step: OnboardingStep, copiedCount: number | null) {
  const store = useStore();

  useEffect(() => {
    if (!isFirstSyncOutcome(step) || store.get(onboardingRunAtom).phase !== "started") return;
    store.set(onboardingRunAtom, { outcome: step, phase: "settled" });
    if (step === "copied") track(ANALYTICS_EVENTS.onboarding_completed, { events_copied: copiedCount ?? 0 });
  }, [store, step, copiedCount]);
}
