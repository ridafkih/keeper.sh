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
    <div className="mx-auto grid w-full max-w-6xl grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-4">
      <div>
        {back && (
          <Button variant="border" size="compact" className="aspect-square" aria-label="Back" onClick={() => onBack(back)}>
            <ButtonIcon>
              <ArrowLeft size={16} />
            </ButtonIcon>
          </Button>
        )}
      </div>
      <ol className="mx-auto flex w-full max-w-sm gap-1.5" aria-label={`Step ${current + 1} of ${ONBOARDING_STEPS.length}`}>
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
        {canSkipOnboardingAt(step) && (
          <Button variant="ghost" size="compact" disabled={skipping} onClick={onSkip}>
            <ButtonText>Skip for Now</ButtonText>
          </Button>
        )}
      </div>
    </div>
  );
}
