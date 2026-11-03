type OnboardingStep =
  | "welcome"
  | "add-destination"
  | "ready"
  | "copying"
  | "copied"
  | "nothing-to-copy"
  | "home";

type FirstSyncOutcome = Extract<OnboardingStep, "copied" | "nothing-to-copy">;

type OnboardingRun =
  | { phase: "idle" }
  | { phase: "started"; startedAfterSeq: number }
  | { phase: "settled"; outcome: FirstSyncOutcome }
  | { phase: "finished" };

interface MappingSyncSnapshot {
  failingCount: number;
  pendingCount: number;
  seq: number;
}

interface OnboardingStepInput {
  hasCalendars: boolean;
  hasProposal: boolean;
  hasConfiguredSync: boolean;
  run: OnboardingRun;
  mappingSync: MappingSyncSnapshot | null;
  syncing: boolean;
  copiedCount: number | null;
}

const resolveSetupStep = ({ hasCalendars, hasProposal, hasConfiguredSync }: OnboardingStepInput): OnboardingStep => {
  if (hasConfiguredSync) return "home";
  if (!hasCalendars) return "welcome";
  if (hasProposal) return "ready";
  return "add-destination";
};

const resolveFirstSyncStep = (
  { mappingSync, syncing, copiedCount }: OnboardingStepInput,
  startedAfterSeq: number,
): OnboardingStep => {
  if (!mappingSync || mappingSync.seq <= startedAfterSeq) return "copying";
  if (mappingSync.failingCount > 0) return "home";
  if (mappingSync.pendingCount > 0 || syncing || copiedCount === null) return "copying";
  if (copiedCount > 0) return "copied";
  return "nothing-to-copy";
};

const isFirstSyncOutcome = (step: OnboardingStep): step is FirstSyncOutcome =>
  step === "copied" || step === "nothing-to-copy";

const resolveOnboardingStep = (input: OnboardingStepInput): OnboardingStep => {
  if (input.run.phase === "finished") return "home";
  if (input.run.phase === "settled") return input.run.outcome;
  if (input.run.phase === "started") return resolveFirstSyncStep(input, input.run.startedAfterSeq);
  return resolveSetupStep(input);
};

export { isFirstSyncOutcome, resolveOnboardingStep };
export type { FirstSyncOutcome, MappingSyncSnapshot, OnboardingRun, OnboardingStep, OnboardingStepInput };
