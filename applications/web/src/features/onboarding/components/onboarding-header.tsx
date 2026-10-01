import { useRef } from "react";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import { Button, ButtonIcon, ButtonText } from "@/components/ui/primitives/button";
import { Text } from "@/components/ui/primitives/text";
import { useScrolledFlag } from "@/hooks/use-scrolled-flag";
import { cn } from "@/utils/cn";
import {
  ONBOARDING_STEPS,
  ONBOARDING_STEP_LABELS,
  canSkipOnboardingAt,
  previousOnboardingStep,
  type OnboardingStep,
} from "../onboarding-steps";

interface OnboardingHeaderProps {
  step: OnboardingStep;
  skipping: boolean;
  onBack: (step: OnboardingStep) => void;
  onSkip: () => void;
}

export function OnboardingHeader({ step, skipping, onBack, onSkip }: OnboardingHeaderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const current = ONBOARDING_STEPS.indexOf(step);
  const back = previousOnboardingStep(step);
  useScrolledFlag(ref);

  // Spans the layout's side padding so its background covers content scrolling beneath it at any width.
  return (
    <div
      ref={ref}
      data-scrolled="false"
      className="sticky top-0 z-[7] -mx-4 -mt-4 bg-background px-4 pt-4 pb-3 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-6 after:bg-linear-to-b after:from-background after:to-transparent after:opacity-0 after:transition-opacity data-[scrolled=true]:after:opacity-100 lg:-mx-10 lg:px-10"
    >
      {/* Phones put the step bar on its own full-width row under Back and Skip for Now; wider screens centre it between them. */}
      <div className="mx-auto grid w-full max-w-6xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,24rem)_minmax(0,1fr)]">
        {/* Both buttons keep their space when a step has no use for them, so moving between steps never shifts the bar. */}
        <div className="col-start-1 row-start-1">
          <Button
            variant="border"
            size="compact"
            className={cn("aspect-square", !back && "invisible")}
            aria-label="Back"
            aria-hidden={!back}
            tabIndex={back ? undefined : -1}
            disabled={!back}
            onClick={() => back && onBack(back)}
          >
            <ButtonIcon>
              <ArrowLeft size={16} />
            </ButtonIcon>
          </Button>
        </div>
        <ol className="col-span-3 row-start-2 flex w-full gap-1.5 sm:col-span-1 sm:col-start-2 sm:row-start-1" aria-label={`Step ${current + 1} of ${ONBOARDING_STEPS.length}`}>
          {ONBOARDING_STEPS.map((candidate, index) => (
            <li key={candidate} className="flex min-w-0 flex-1 flex-col gap-1.5" aria-current={index === current ? "step" : undefined}>
              <span className={cn("h-0.75 rounded-full", index <= current ? "bg-foreground" : "bg-interactive-border")} />
              <Text size="xs" tone={index === current ? "default" : "muted"} className="truncate">
                {ONBOARDING_STEP_LABELS[candidate]}
              </Text>
            </li>
          ))}
        </ol>
        <div className="col-start-3 row-start-1 flex justify-end">
          <Button
            variant="ghost"
            size="compact"
            className={cn(!canSkipOnboardingAt(step) && "invisible")}
            aria-hidden={!canSkipOnboardingAt(step)}
            tabIndex={canSkipOnboardingAt(step) ? undefined : -1}
            disabled={skipping || !canSkipOnboardingAt(step)}
            onClick={onSkip}
          >
            <ButtonText>Skip for Now</ButtonText>
          </Button>
        </div>
      </div>
    </div>
  );
}
