import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, LazyMotion, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { loadMotionFeatures } from "@/lib/motion-features";
import { INSTANT_TRANSITION, PAGE_TRANSITION, pageVariants } from "@/lib/page-transition";
import { resolveScrollParent } from "@/lib/scroll-parent";
import type { SidebarDirection } from "@/lib/sidebar-transition";
import { ANALYTICS_EVENTS, track } from "@/lib/analytics";
import { ScrollFader } from "@/components/ui/primitives/scroll-fader";
import { cn } from "@/utils/cn";
import { recordOnboarding } from "../record-onboarding";
import { ONBOARDING_STEPS, type OnboardingSearch, type OnboardingStep } from "../onboarding-steps";
import { OnboardingHeader } from "./onboarding-header";
import { WelcomeStep } from "./welcome-step";
import { ConnectStep } from "./connect-step";
import { FirstSyncStep } from "./first-sync-step";
import { DoneStep } from "./done-step";

export function OnboardingPage({ search }: { search: OnboardingSearch }) {
  const navigate = useNavigate();
  const [skipping, setSkipping] = useState(false);
  const step: OnboardingStep = search.step === "done" && !search.syncId ? "sync" : search.step ?? "welcome";

  const reduceMotion = useReducedMotion() ?? false;
  const rootRef = useRef<HTMLDivElement>(null);
  const [tracked, setTracked] = useState<{ step: OnboardingStep; direction: SidebarDirection | null }>({ direction: null, step });

  // Steps share one route, so the dashboard's route-keyed transition can't see them; the direction comes from the step order instead.
  if (tracked.step !== step) {
    const direction = ONBOARDING_STEPS.indexOf(step) > ONBOARDING_STEPS.indexOf(tracked.step) ? "forward" : "back";
    setTracked({ direction, step });
  }

  useEffect(() => {
    track(ANALYTICS_EVENTS.onboarding_step_viewed, { step });
  }, [step]);

  // Like the dashboard, moving forward starts the next step at the top.
  useLayoutEffect(() => {
    if (tracked.direction !== "forward" || !rootRef.current) return;
    const parent = resolveScrollParent(rootRef.current);
    if (parent) parent.scrollTop = 0;
  }, [tracked]);

  const goTo = (next: OnboardingStep, extra: Omit<OnboardingSearch, "step"> = {}) =>
    navigate({ search: { ...extra, step: next }, to: "/onboarding" });

  // Recording the skip can fail without trapping anyone: the redirect only follows a pending status.
  const skip = async () => {
    setSkipping(true);
    track(ANALYTICS_EVENTS.onboarding_skipped, { step });
    await recordOnboarding("skipped").catch(() => undefined);
    await navigate({ to: "/dashboard" });
  };

  let content = (
    <ScrollFader>
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
    </ScrollFader>
  );
  if (step === "sync") {
    content = (
      <FirstSyncStep
        onAddCalendars={() => void goTo("connect")}
        onStarted={(syncId) => void goTo("done", { syncId })}
      />
    );
  }

  return (
    // First Sync fills the window at lg so its column can scroll on its own; 6rem is the full-screen layout's padding.
    <div ref={rootRef} className={cn("relative flex flex-1 flex-col gap-7", step === "sync" && "lg:h-[calc(100dvh-6rem)] lg:flex-none")}>
      <OnboardingHeader step={step} skipping={skipping} onBack={(back) => void goTo(back)} onSkip={() => void skip()} />
      {/* A short step's bottom padding matches the header and gap above, so it sits on the window's centre line. */}
      <LazyMotion features={loadMotionFeatures}>
        <AnimatePresence mode="popLayout" initial={false} custom={tracked.direction}>
          <m.div
            key={step}
            className={cn(
              "flex flex-col",
              step === "sync" ? "lg:min-h-0 lg:flex-1" : "flex-1 justify-center pb-[calc(var(--onboarding-header-offset,0px)+1.75rem)]",
            )}
            custom={tracked.direction}
            variants={pageVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={reduceMotion ? INSTANT_TRANSITION : PAGE_TRANSITION}
          >
            {content}
          </m.div>
        </AnimatePresence>
      </LazyMotion>
    </div>
  );
}
