export type SetupStepKey = "connect" | "second" | "sync";

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
  syncCount,
}: {
  sourceCount: number;
  accountCount: number;
  syncCount: number;
}): SetupSteps => ({
  show: syncCount === 0,
  steps: [
    { done: sourceCount > 0, key: "connect" },
    { done: accountCount > 1, key: "second" },
    { done: syncCount > 0, key: "sync" },
  ],
});
