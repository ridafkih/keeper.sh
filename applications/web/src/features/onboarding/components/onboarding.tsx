import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useSWRConfig } from "swr";
import KeeperLogo from "@/assets/keeper.svg?react";
import { Button, ButtonText } from "@/components/ui/primitives/button";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { reportFunnelEvent } from "@/lib/funnel-events";
import { isEventsKey } from "@/lib/swr";
import { onboardingRunAtom } from "@/state/onboarding";
import { syncStateAtom } from "@/state/sync";
import type { OnboardingState } from "../use-onboarding";
import { resolveCopiesVersion } from "../copies-version";
import { useSettleFirstSync } from "../use-settle-first-sync";
import type { OnboardingStep } from "../onboarding-step";
import { WelcomeStep } from "./welcome-step";
import { AddDestinationStep } from "./add-destination-step";
import { ReadyStep } from "./ready-step";
import { CopyingStep } from "./copying-step";
import { CopiedStep } from "./copied-step";
import { NothingToCopyStep } from "./nothing-to-copy-step";

const STEP_NUMBERS: Record<OnboardingStep, number> = {
  "add-destination": 3,
  copied: 6,
  copying: 5,
  home: 7,
  "nothing-to-copy": 6,
  ready: 4,
  welcome: 1,
};

function useStepViewed({ step, origin, sameAccountDestinations }: OnboardingState) {
  const firstAccountProvider = origin?.provider ?? "none";
  const sameAccountCalendars = sameAccountDestinations.length;

  useEffect(() => {
    track(ANALYTICS_EVENTS.onboarding_step_viewed, {
      onboarding_first_account_provider: firstAccountProvider,
      onboarding_same_account_calendars: sameAccountCalendars,
      onboarding_step: STEP_NUMBERS[step],
      ui_screen: `onboarding.${step}`,
    });
    reportFunnelEvent({
      event: "onboarding.step_viewed",
      firstAccountProvider,
      sameAccountCalendars,
      step,
    });
  }, [step, firstAccountProvider, sameAccountCalendars]);
}

function useLivePreview() {
  const { mutate } = useSWRConfig();
  const copiesVersion = resolveCopiesVersion(useAtomValue(syncStateAtom));

  useEffect(() => {
    void mutate(isEventsKey);
  }, [mutate, copiesVersion]);
}

function LeaveSetup() {
  const setRun = useSetAtom(onboardingRunAtom);
  return (
    <Button variant="ghost" className="w-full justify-center" onClick={() => setRun({ phase: "finished" })}>
      <ButtonText>Go to home</ButtonText>
    </Button>
  );
}

function OnboardingStepContent({ state }: { state: OnboardingState }) {
  const { step, origin, proposal, copies, calendars, sameAccountDestinations } = state;

  if (step === "add-destination" && origin) {
    return (
      <>
        <AddDestinationStep calendars={calendars} origin={origin} sameAccountDestinations={sameAccountDestinations} />
        <LeaveSetup />
      </>
    );
  }
  if (step === "ready" && proposal) return <ReadyStep proposal={proposal} />;
  if (step === "copying") return <CopyingStep copies={copies} calendars={calendars} />;
  if (step === "copied" && copies) return <CopiedStep copies={copies} calendars={calendars} proposal={proposal} />;
  if (step === "nothing-to-copy" && proposal) return <NothingToCopyStep proposal={proposal} calendars={calendars} />;
  return (
    <>
      <WelcomeStep />
      <LeaveSetup />
    </>
  );
}

export function Onboarding({ state }: { state: OnboardingState }) {
  useStepViewed(state);
  useSettleFirstSync(state.step, state.copies?.count ?? null);
  useLivePreview();

  return (
    <div className="flex flex-col gap-1.5">
      <OnboardingStepContent state={state} />
      <div className="pt-8 flex justify-center">
        <KeeperLogo className="size-8 text-border-elevated self-center" />
      </div>
    </div>
  );
}
