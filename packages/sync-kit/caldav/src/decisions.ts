interface CoverageDecision {
  readonly collectionPath: string;
  readonly resourcePaths: readonly string[];
}

interface DecisionRecord {
  readonly recordCoverage: (decision: CoverageDecision) => void;
  readonly recordAttempts: (spent: number, allowed: number) => void;
  readonly coverageCameFromOneCollection: () => boolean;
  readonly attemptsWithinBudget: () => boolean;
}

const allUnder = (collectionPath: string, resourcePaths: readonly string[]): boolean =>
  resourcePaths.every((path) => path.startsWith(collectionPath));

const createDecisionRecord = (): DecisionRecord => {
  const state: { coverage: CoverageDecision | null; overspent: boolean } = {
    coverage: null,
    overspent: false,
  };

  return {
    recordCoverage: (decision: CoverageDecision) => {
      state.coverage = decision;
    },
    recordAttempts: (spent: number, allowed: number) => {
      state.overspent = state.overspent || spent > allowed;
    },
    coverageCameFromOneCollection: () => {
      if (state.coverage === null) {
        return true;
      }
      return allUnder(state.coverage.collectionPath, state.coverage.resourcePaths);
    },
    attemptsWithinBudget: () => !state.overspent,
  };
};

export { createDecisionRecord };
export type { CoverageDecision, DecisionRecord };
