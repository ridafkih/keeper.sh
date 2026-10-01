import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import { Button, ButtonIcon, ButtonText } from "@/components/ui/primitives/button";
import { Text } from "@/components/ui/primitives/text";
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
  const current = ONBOARDING_STEPS.indexOf(step);
  const back = previousOnboardingStep(step);

  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,24rem)_minmax(0,1fr)]">
      {/* Both buttons keep their space when a step has no use for them, so moving between steps never shifts the bar. */}
      <div>
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
      <ol className="flex w-full gap-1.5" aria-label={`Step ${current + 1} of ${ONBOARDING_STEPS.length}`}>
        {ONBOARDING_STEPS.map((candidate, index) => (
          <li key={candidate} className="flex min-w-0 flex-1 flex-col gap-1.5" aria-current={index === current ? "step" : undefined}>
            <span className={cn("h-0.75 rounded-full", index <= current ? "bg-foreground" : "bg-interactive-border")} />
            <Text size="xs" tone={index === current ? "default" : "muted"} className="hidden truncate xs:block">
              {ONBOARDING_STEP_LABELS[candidate]}
            </Text>
          </li>
        ))}
      </ol>
      <div className="flex justify-end">
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
  );
}
