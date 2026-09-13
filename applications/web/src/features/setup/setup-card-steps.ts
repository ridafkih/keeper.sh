export type SetupStepKey = "connect" | "second" | "rules";

export interface SetupStep {
  key: SetupStepKey;
  done: boolean;
}

export interface SetupSteps {
  show: boolean;
  steps: SetupStep[];
}

export const resolveSetupSteps = ({
  sourceCount,
  accountCount,
  mappingCount,
}: {
  sourceCount: number;
  accountCount: number;
  mappingCount: number;
}): SetupSteps => ({
  show: mappingCount === 0,
  steps: [
    { done: sourceCount > 0, key: "connect" },
    { done: accountCount > 1, key: "second" },
    { done: mappingCount > 0, key: "rules" },
  ],
});
