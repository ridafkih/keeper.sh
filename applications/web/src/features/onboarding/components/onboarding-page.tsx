import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ANALYTICS_EVENTS, track } from "@/lib/analytics";
import { recordOnboarding } from "../record-onboarding";
import type { OnboardingSearch, OnboardingStep } from "../onboarding-steps";
import { OnboardingHeader } from "./onboarding-header";
import { WelcomeStep } from "./welcome-step";
import { ConnectStep } from "./connect-step";
import { FirstSyncStep } from "./first-sync-step";
import { DoneStep } from "./done-step";

export function OnboardingPage({ search }: { search: OnboardingSearch }) {
  const navigate = useNavigate();
  const [skipping, setSkipping] = useState(false);
  const step: OnboardingStep = search.step === "done" && !search.syncId ? "sync" : search.step ?? "welcome";

  useEffect(() => {
    track(ANALYTICS_EVENTS.onboarding_step_viewed, { step });
  }, [step]);

  const goTo = (next: OnboardingStep, extra: Omit<OnboardingSearch, "step"> = {}) =>
    navigate({ search: { ...extra, step: next }, to: "/onboarding" });

  // Recording the skip can fail without trapping anyone: the redirect only follows a pending status.
  const skip = async () => {
    setSkipping(true);
    track(ANALYTICS_EVENTS.onboarding_skipped, { step });
    await recordOnboarding("skipped").catch(() => undefined);
    await navigate({ to: "/dashboard" });
  };

  return (
    <div className="flex flex-1 flex-col gap-10">
      <OnboardingHeader step={step} skipping={skipping} onBack={(back) => void goTo(back)} onSkip={() => void skip()} />
      {step === "sync" ? (
        <FirstSyncStep
          onAddCalendars={() => void goTo("connect")}
          onStarted={(syncId) => void goTo("done", { syncId })}
        />
      ) : (
        // The bottom padding matches the header above, so a short step sits on the window's centre line.
        <div className="flex flex-1 flex-col justify-center pb-19">
          {step === "welcome" && <WelcomeStep onStart={() => void goTo("connect")} />}
          {step === "connect" && (
            <ConnectStep
              accountId={search.accountId}
              error={search.error}
              onContinue={() => void goTo("sync")}
              onImported={(accountId) => void goTo("connect", { accountId })}
            />
          )}
          {step === "done" && search.syncId && <DoneStep syncId={search.syncId} />}
        </div>
      )}
    </div>
  );
}
