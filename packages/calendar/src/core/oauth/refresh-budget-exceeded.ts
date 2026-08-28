class RefreshBudgetExceededError extends Error {
  readonly inFlightAttempt: Promise<unknown>;

  constructor(budgetMs: number, inFlightAttempt: Promise<unknown>) {
    super(`token refresh exceeded its ${budgetMs}ms wall-time budget`);
    this.name = "RefreshBudgetExceededError";
    this.inFlightAttempt = inFlightAttempt;
  }
}

export { RefreshBudgetExceededError };
