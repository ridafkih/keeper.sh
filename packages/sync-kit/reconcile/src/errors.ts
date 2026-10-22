class ReconcileInternalDataError extends Error {
  readonly invariant: string;

  constructor(invariant: string) {
    super(`sync-reconcile broke its own invariant: ${invariant}`);
    this.name = "ReconcileInternalDataError";
    this.invariant = invariant;
  }
}

export { ReconcileInternalDataError };
