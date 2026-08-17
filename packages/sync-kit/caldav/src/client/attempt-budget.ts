interface AttemptBudget {
  readonly claim: () => boolean;
  readonly spent: () => number;
  readonly remaining: () => number;
}

const createAttemptBudget = (maxAttempts: number): AttemptBudget => {
  const ceiling = Math.max(0, maxAttempts);
  const budget = { spent: 0 };
  return {
    claim: () => {
      if (budget.spent >= ceiling) {
        return false;
      }
      budget.spent += 1;
      return true;
    },
    spent: () => budget.spent,
    remaining: () => Math.max(0, ceiling - budget.spent),
  };
};

export { createAttemptBudget };
export type { AttemptBudget };
